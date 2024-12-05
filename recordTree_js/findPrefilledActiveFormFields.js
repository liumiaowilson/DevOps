const controllingRecordId = 'a1QUl000000UFRRMA4';

(function(record, cmd, context) {
    if(record.attributes.type === 'practifi__Active_Form_Field__c') {
        if(record['practifi__Prefill_Form_Field__c'] === controllingRecordId) {
            cmd.log(record.Name);
        }
    }
})
