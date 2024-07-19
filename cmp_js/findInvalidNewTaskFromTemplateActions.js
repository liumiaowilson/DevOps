const availableFields = [
    'recordId',
    'templateRelatedTo',
    'contactList',
    'teamMemberList',
    'serviceList',
    'dealList',
    'accountList',
    'divisionList',
    'processList',
];

(function(json, context, cmd, cmpName) {
    if(json.type === 'flow' && json.params?.flowName === 'practifi__New_Record_New_Task_From_Task_Template') {
        const hasInvalidField = Object.keys(json.params.flowParams || {}).some(param => !availableFields.includes(param));
        if(hasInvalidField) {
            cmd.log(cmpName);
        }
    }

    return json;
})
