(function(record, cmd, context) {
    if(record.attributes.type === 'practifi__Active_Form_Field__c') {
        const name = record.Name;
        const info = 'Main Information - A';
        if(name.startsWith(info) && name.length === info.length + 25) {
            cmd.log(name);
        }
    }
})
