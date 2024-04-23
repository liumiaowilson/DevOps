(function(cmd, context) {
    const name = context.argv[0];
    if(!name) {
        cmd.error('Name is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Generating Data Raptor Query');
    return context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8').then(keyPrefixJSON => {
        const keyPrefix = JSON.parse(keyPrefixJSON);
        const objectApiName = Object.values(keyPrefix).filter(val => val.endsWith('DRBundle__c'))[0];
        const [ ns, ] = objectApiName.split('__');
        const query = [
          `SELECT FIELDS(All) FROM ${ns}__DRBundle__c WHERE Name = '${name}'`,
          `SELECT FIELDS(All) FROM ${ns}__DRMapItem__c WHERE Name = '${name}' ORDER BY ${ns}__DomainObjectCreationOrder__c ASC`,
        ].join("\n");

        cmd.log(query);

        return query;
    }).finally(() => context.ux.action.stop());
})
