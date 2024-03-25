(function(record, cmd, context) {
    if(record.attributes.type === 'practifi__Active_Form_Field__c') {
        if(record['practifi__Prefill_This_Field__c'] === 'With a value from another Active Form Field in this workflow') {
            cmd.log(record.Name + '[m://' + record.Id + ']');
        }
    }
})
