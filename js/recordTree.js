({
    practifi__Active_Form_Field__c: function(record, parentRecord, parentKey) {
        if(parentRecord && parentRecord.attributes.type === 'practifi__Process_Task__c' && record.practifi__Section__c) {
            return;
        }

        const tags = [];
        if(record.practifi__Required__c) {
            tags.push('*');
        }
        if(record.practifi__Prefill_This_Field__c) {
            tags.push('_');
        }
        if((record.practifi__Display_To__c && record.practifi__Display_To__c !== 'Internal and Portal Users') ||
            record.practifi__Visibility_Rule__c ||
            record.practifi__Display_This_Field_If__c) {
            tags.push('?');
        }

        return record.Name +
            (record.practifi__Type__c ? `[${record.practifi__Type__c}]` : '') +
            (tags.length ? `[${tags.join('')}]` : '');
    },

    practifi__Active_Form_Field_Section__c: function(record, parentRecord, parentKey) {
        const tags = [];
        if(record.practifi__Repeat_Using__c) {
            tags.push('#');
        }
        if(record.practifi__Display_This_Field_Section_If__c || record.practifi__Visibility_Rule__c) {
            tags.push('?');
        }

        return record.Name + (tags.length ? `[${tags.join('')}]` : '');
    },

    practifi__Action__c: function(record, parentRecord, parentKey) {
        const tags = [];
        if(record.practifi__Execution_Rule__c) {
            tags.push('?');
        }

        return record.Name +
            (record.practifi__Action_Type__c ? `[${record.practifi__Action_Type__c}]` : '') +
            (tags.length ? `[${tags.join('')}]` : '');
    },

    practifi__Process_Task__c: function(record, parentRecord, parentKey) {
        return record.practifi__Subject__c;
    },
})
