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
    else {
        cmd.error('Not supported yet');
    }
})
