// Test-only entry point exposes the application's controller for assertions.
const sessions=require('../src/picker-session.cjs');
const Original=sessions.PickerSession;
sessions.PickerSession=class extends Original {
  constructor(options){super(options);global.__pickerTestSession=this;global.__testSelections=[];}
  async select(copy){const result=await super.select(copy);global.__testSelections.push(result);return result;}
};
require('../main.js');
