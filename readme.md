# Interface version adapter

This is a toy project to illustrate an idea.

The problem this is trying to solve is that when two components of your system exchange data (e.g. a client/server, pub/sub, or clients of a database), it's hard to upgrade the structure of the data over time while maintaining cross compatibility with older clients or older data.

The toy solution here is a library that allows you to do something like this:

```js
import { emptySchema } from './lib.mjs'

// Version 1 of the schema has a "message" field
const version1 = emptySchema.addField('message');
// Version 2 renames this to "printout"
const version2 = version1.renameField('message', 'printout');

// We can create 2 views of the same underlying data object
const view1 = version1.newInstance({});
const view2 = version2.viewInstance(view1);

// Accessing field `message` of view1 is equivalent to
// accessing field `printout` of view2
view1.message = 'Hello';
console.log(view1.message); // Hello
console.log(view2.printout); // Hello
view2.printout = 'World';
console.log(view1.message); // World
console.log(view2.printout); // World
```

The more complete example is in [app.mjs](./app.mjs) and the source of the library is [lib.mjs](./lib.mjs).

### Tricky cases

This library deals with some of the tricky complexities, such as the following case where one field is renamed to the name of another field that is removed. Here, `fieldX` in version 1 is renamed to `fieldY` in version 2, but there was already a field name `fieldX` in version 1, which is removed in version 2, and version 2 also has its own new field called `fieldX`.

![](doc/image/2022-11-28%20Field%20rename.png)

```js
const version1 = emptySchema
  .addField('fieldX')
  .addField('fieldY')

const version2 = version1
  .removeField('fieldY')
  .renameField('fieldX', 'fieldY')
  .addField('fieldX')

const view1 = version1.newInstance({});
const view2 = version2.viewInstance(view1);

view1.fieldX = 'fieldXWrittenInVersion1';
view1.fieldY = 'fieldYWrittenInVersion1';
console.log(view1.fieldX); // fieldXWrittenInVersion1
console.log(view1.fieldY); // fieldYWrittenInVersion1
console.log(view2.fieldX); // undefined
console.log(view2.fieldY); // fieldXWrittenInVersion1
view2.fieldX = 'fieldXWrittenInVersion2';
view2.fieldY = 'fieldYWrittenInVersion2';
console.log(view1.fieldX); // fieldYWrittenInVersion2 <-- updated
console.log(view1.fieldY); // fieldYWrittenInVersion1 <-- preserved
console.log(view2.fieldX); // fieldXWrittenInVersion2
console.log(view2.fieldY); // fieldYWrittenInVersion2
```

Note in particular that in this example, the data store has preserved the original `view1.fieldY` even when mutating the object through view 2 which does not have an equivalent of the same field, but which has a different field with a conflicting name. The same would be true in the opposite direction: if an older client writes to a newer-version data instance, the newer-version data is is preserved alongside the modifications done by the older client.

The point is not that you may need to do this specifically, but that the edge cases can be tricky to reason about and it's better to have a library like this that just handles it for you and preserves as much information as possible across the different versions.

### How might a library like this be used?

Examples:

  - A server automatically views clients request through the lens of its own latest data model, and a client can similarly view the response through the lens of its data model.

  - The underlying state of the instance could be preserved in a database, and separately the schema history can be preserved in the same database, allowing all clients of the database to transparently view data objects through their own data model version, even if the object state contains information provided through data models that didn't exist at the time the database client was deployed.

  - Even within a single, large codebase, if a model is shared across the whole codebase then it's difficult to make incremental changes to the data models, because you have to update all the places that use it. A library like this could be used to provide translation boundaries where different parts of the app are operating under different versions of the data model and they can seamlessly talk to each other, obviating the need for monolithic data model refactoring.

  - In general, I think in a lot of cases that a library like this obviates the need for hand-crafted decoupling APIs, since it allows different parts of the system to share common and cohesive type definitions for shared entities (such as models of the domain) without suffering the problem of needing a monolithic migration to update such models.


### What else is needed to make a library like this practical?

  - Persistence - the data behind schemas and instances needs to be serializable. As noted later in this document, one such representation may be JSON Schema and JSON Patch.

  - Nested structures and shared sub-schemas.

  - Other schema operations beyond `addField`, `renameField` and `removeField`.

  - Custom transforms at the field level and whole-object level

  - Modularity and cohesion - thinking more carefully about how schemas can be defined that doesn't require one monolithic sequence of delta statements that couples all the sub-schemas together.


# Problem Statement

This section contains a more detailed description of the background and thought process. Note that this was written before the toy example library was written.

-----------------

This is a really common problem:

- Version 1 of an app stores persistent data in version 1 of a data structure.
- When version 2 of the app needs is released, it needs to access the data stored by version 1, and may need to save its own data in version 2.

Version 1 and version 2 are essentially communicating to each other via the stored data. Like the movie [The Lake House](https://en.wikipedia.org/wiki/The_Lake_House_(film)), they pass messages to each other via the persistent storage. This communication is normally thought of as uni-directional, since the old version passes data to the new version, forward in time, but it may be bi-directional if for some reason you need to roll back the new version to the old version and have it deal sensibly with any data written by the new version.

What I mean by "app" or "persistent storage" in this description is quite general. Any code in any program that needs to store state in some way, whether in a file, relational database, noSQL database, or something else, either directly or indirectly through an API, can exhibit this problem.

Some common solutions to this problem:

- Don't change the data structure: In these scenarios, there is pressure to keep the data structure the same to avoid breaking things, or to only make backwards-compatible changes such as adding new fields but leaving old ones untouched. This precludes a lot of clean-up work and refactoring of the structure itself, and results in messy data structures over time. Like, how many people have encountered a legacy SQL database that has a fragile structure but nobody dares to touch it because of all the things coupled to that structure.

- Perform a migration. Either a once-off script that upgrades the data from old version to the new, or promoting it on-demand.

- A translation layer such as an API or DAL (database abstraction layer), which can do translations on the fly. Normally I see these are written by hand. I'm not aware of any automatically-generated storage abstractions that can also translate between different data versions. This is more-or-less what I'm proposing in this document.

There's another closely-related problem which I think may share a similar solution:

- Service A and service B send messages to each other (e.g. HTTP request and response, pub-sub, etc).
- Version 1 of service A speaks the same message structure as version 1 of service B.
- When version 2 of service A is released, it needs to understand the message structure of version 1 of service B.

This is roughly the same problem. Two entities are communicating to each other through some protocol. In the data-storage problem, the entities communicate over time, while in the messaging problem, they communicate over space. There are an analogous 3 solutions to this problem:

- Don't change the message structure, or only change it in backwards-compatible ways. It gets messy over time because you're still dealing with choices made a long time ago.

- Upgrade both services atomically/monolithically. This is fine in smaller systems, but precludes incremental development where pieces of your system need to be changed incrementally.

- Add translation layers such as APIs, which translate and decouple service A from service B.

Most often I hear that an API or DAL is the "correct" solution. It adds decoupling and allows the provider and consumer of the data to be independent. But I don't think this really solves the problem. It adds complexity to the architecture and extra work to create the translation layer, while still leaving the translation layer itself coupled to both data formats. Some problems with this solution:

- System complexity - API services that exist purely for decoupling and translation but do not solve any business problem and contain no business logic.

- Fragmentation of data models. Your domain might only have one thing that you call a "customer", but half your services have different internal types they use to represent a customer.

- Lots of unnecessary code doing translations between different people's ideal of a particular domain entity, because using a common model is considered "bad practice" because it couples all the systems together (as a shared message structure or data structure).


## A proposed solution

For this proposal, I will assume that JSON is the basis of the interchange format. If you're using a noSQL database or JSON API, this will fit directly.

I will also assume that your code is in JavaScript.

The high-level idea is this:

  1. Define your data structure in terms of JSON Schema, since this is a standard way to represent the structure of JSON objects. This does not necessarily mean that you need to write JSON Schema by hand -- it would be easy to imagine a higher level syntax representation of JSON Schema, perhaps something that looks like TypeScript (does this exist already?).

  2. Define changes to your data structure in terms of a JSON Patch to your JSON Schema. Only a subset of JSON Patch would be allowed in the same way that JSON Schema is itself a subset of JSON. Only JSON Patches that produce valid JSON Schema are allowed, and only JSON Patches that are semantically recognized changes are allowed. And again, you wouldn't necessarily write the JSON Patch by hand, but using JSON Patch as a format means that common tooling can be built around it.

  3. Create a library that given the chain of schema updates can provide a mapping from data represented in any schema version to any other. E.g. `transformData(data, fromVersion, toVersion)`

An extension to this idea is to use a language like [Jessie](https://github.com/endojs/Jessie) to add computational conversions between fields in one version of the data model and fields in the next version. For example, maybe in version 1 of the data model you used `dd/mm/yyyy` dates but then realized how stupid that is and want to define a schema change that maps to `yyyy-mm-dd` dates. Where JSON is a POD subset of JavaScript, Jessie is proposed to be a computational subset of JavaScript. Strings of JSON represent data, and strings of Jessie represent computations. Note that Jessie has kinda stagnated and never became a standard, but if a computational subset of JavaScript is needed, I think Jessie is the best candidate I'm aware of to start building upon.

It may be necessary to define a superset of JSON Patch that holds other semantic information about the transform from one schema to another, but I'm not sure yet.

## Using it

Users of this library can use it in a number of ways. For example:

- A service can automatically translate requests from the version of the client to the version of the server, and correspondingly translate responses from the version of the server to the version of the client.

- An app can automatically translate database responses from the stored version to the version that the app understands (which may be an earlier or later version, depending on how old the data is or if the data has been written by a later version of the app).

- Since the schema transforms are represented as data, they can be stored in a database alongside the data they describe. This allows a client of the database to deal with schema versions that didn't even exist at the time that the client was released, which obviates the need for an interceding API.


## Why a patch for the schema rather than a patch for the data?

If you have an array of X inside the JSON, and you want to rename a field of X, a schema patch can describe this abstract operation while a patch on a concrete data object would need to rename the field on each instance of X, which is not known in advance since different data objects may have a different number of entries in the array.


## Mutable data

In the case of requests and responses to/from a server, the messages are logically immutable and ephemeral. In the case of stored data however, it's common to model the data as mutable and needing to be updated over time. For example, if your domain has a `Customer` and the `Customer` has a `phoneNumber`, you may need to support the ability for them to change their phone number (regardless of how you actually store this information).

For the most part, this proposal doesn't dictate how you deal with this situation, but one possible way is as follows.

Consider the following example case:

- A `Customer` wants to change their phone number.
- The customer data was previously stored in version 1.
- The latest data schema is version 2. There could be changes to the `phoneNumber` field or other fields.

One possible way to deal with this scenario is to do a data migration from version 1 to version 2, and then set the `phoneNumber` field on the version 2 data model (and save version 2 in the database, replacing version 1). However, migrations are not guaranteed to be lossless, and this does not preserve the original customer data as it was initially recorded. A better approach is as follows:

1. Transform the content of the data object from its stored version to the version of the mutating client. E.g. from version 1 to version 2 in this case.
2. Perform the mutation on the transformed data (version 2).
3. Compute a diff between the unmutated and mutated data (in version 2), and store this diff, rather than the full object itself.

So the final state of the database is an original record in version 1, followed by a diff in version 2. This preserves the original data non-destructively in its original version, while also preserving the change in the new version, which may include changes that were not even possible in the original version (e.g. maybe the original `Customer` model didn't even have a `phoneNumber`).

Then what if an older client wants to read the updated model in version 1? In general, the final model state in any version N can be calculated by:

1. Transforming the original record into version N (in our example, this is a no-op because the original format was already version 1, the same as the target version).
2. Transforming the sequence of deltas each into version N, and applying them sequentially.

A delta `D1` can be transformed from version N1 to N2 (to get delta `D2`) as follows:

0. Starting with data object `M0a` in any version.
1. Transform the data object to version N1. Let's call this transformed data object `M1a`.
2. Apply delta `D1` to `M1a` to get `M1b` (`M1b = M1a + D1`).
3. Translate both `M1a` and `M1b` to version N2 to give us `M2a` and `M2b`.
4. Calculate the delta `D2 = M2b - M2a`

![image](https://user-images.githubusercontent.com/2261100/204063609-dac616fc-c4d4-4ee6-a5be-90a81153af4e.png)

This may be inefficient, but it could be defined as the "canonical behavior" and then optimizations can be done where possible.

The reason to translate all the deltas into the target version rather than successively translating the model into each version where a delta appears is that the latter is lossy. If you have a mix of deltas in version 1 and version 2 for example, you don't want to keep upgrading and downgrading the model because it will tend towards the lowest common subset of information between two structures.

Note: we can get rid of the idea of an "original model" if we just define the original model (first version) to always be the empty object. The first usable model can just be a patch on the empty object schema. This may be slightly more elegant and it means that all model versions are treated equally.

### Proxy

A proof of concept of this idea could be manifested as a proxy layer over a mutable data object in JavaScript. Different clients should be able to read and write to the same object through the lens of their own structure versions, and their mutations should be preserved and visible to other clients using different model versions.
