import { emptySchema } from './lib.js'

// Let's say that over time, we progress through 3 different versions of our schema
const version1 = emptySchema.addField('message');
const version2 = version1
  .renameField('message', 'printout')
  .addField('addressee');
const version3 = version2.renameField('addressee', 'name');

// A single instance viewed through 3 different lenses. The instance represents
// some underlying shared data like an object in a no-SQL database. The 3 views
// then represent 3 hypothetical clients accessing this shared data.
const view1 = version1.newInstance({});
const view2 = version2.viewInstance(view1);
const view3 = version3.viewInstance(view1);

// We can write through the version 1 interface and still observe the equivalent
// effects through the version 2 and 3 interfaces.
view1.message = 'Hi';
console.log(view1.message); // Hi
console.log(view2.message); // undefined
console.log(view2.printout); // Hi
console.log(view3.printout); // Hi

// This also works backwards. A write through the version 2 interface is
// observable through the version 1 interface
view2.printout = 'Hello'
console.log(view1.printout); // undefined
console.log(view1.message); // Hello
console.log(view2.printout); // Hello
console.log(view3.printout); // Hello

// This field was introduced in version 2 under a different name, so this change
// through version 3 is not observable in version 1 but is observable in version
// 2 under a different name.
view3.name = 'World';
console.log(view1.name); // undefined
console.log(view1.addressee); // undefined
console.log(view2.name); // undefined
console.log(view2.addressee); // World
console.log(view3.name); // World
console.log(view3.addressee); // undefined
