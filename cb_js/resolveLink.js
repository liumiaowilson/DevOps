(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Link Path is required');
        return;
    }

    const items = path.split('/');
    if(items.length === 1) {
        const recordId = items[0];
        const url = context.connection.instanceUrl + '/' + recordId;
        context.open(url);
        return url;
    }
    else if(items[0] === 'trigger') {
        const objectApiName = items[1];
        const triggerId = items[2];
        const url = `${context.connection.instanceUrl}/lightning/setup/ObjectManager/${objectApiName}/ApexTriggers/${triggerId}/view`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'field') {
        const [ entityId, fieldId ] = items[1].split('.');
        const url = `${context.connection.instanceUrl}/lightning/setup/ObjectManager/${entityId}/FieldsAndRelationships/${fieldId}/view`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'flow') {
        const flowId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/Flows/page?address=%2F${flowId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'validationRule') {
        const durableId = items[1];
        const vrId = items[2];
        const url = `${context.connection.instanceUrl}/lightning/setup/ObjectManager/${durableId}/ValidationRules/${vrId}/view`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'duplicateRule') {
        const ruleId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/DuplicateRules/page?address=%2F${ruleId}%3Fsetupid%3DDuplicateRules`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'assignmentRule') {
        const objectApiName = items[1];
        const ruleId = items[2];
        const url = `${context.connection.instanceUrl}/lightning/setup/${objectApiName}Rules/page?address=%2Fsetup%2Fown%2Fentityruledetail.jsp%3Fid%3D${ruleId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'autoResponseRule') {
        const objectApiName = items[1];
        const ruleId = items[2];
        const url = `${context.connection.instanceUrl}/lightning/setup/${objectApiName}Responses/page?address=%2Fsetup%2Fown%2Fentityruledetail.jsp%3Fid%3D${ruleId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'workflowRule') {
        const ruleId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/WorkflowRules/page?address=%2F${ruleId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'approvalProcess') {
        const recordId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/ApprovalProcesses/page?address=%2F${recordId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'escalationRule') {
        const recordId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/null/page?address=%2Fsetup%2Fown%2Fentityruledetail.jsp%3Fid%3D${recordId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'entitlementProcess') {
        const recordId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/SlaProcess/page?address=%2F${recordId}`;
        context.open(url);
        return url;
    }
    else if(items[0] === 'sharingRule') {
        const recordId = items[1];
        const url = `${context.connection.instanceUrl}/lightning/setup/SecuritySharing/page?address=%2Fsetup%2Fown%2FshareRule.jsp%3Fid%3D${recordId}`;
        context.open(url);
        return url;
    }
    else {
        cmd.error('Not supported yet');
    }
})
