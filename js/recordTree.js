({
    practifi__Active_Form_Field__c: function(record) {
        return record.Name + (record.practifi__Type__c ? `[${record.practifi__Type__c}]` : '');
    },
})
