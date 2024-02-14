(function(cmd, context) {
    const NONE = '--None--';
    const auraName = 'testAuraPOC1542';
    const fileName = auraName;
    const homeDir = '/home/codebuilder/';
    const projectName = 'AuraPoc';

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>*</members>
        <name>AuraDefinitionBundle</name>
    </types>
    <version>60</version>
</Package>`;

    const auraCmp = `<aura:component implements="lightning:isUrlAddressable" access="global">
    <aura:attribute name="recordId" type="String" access="global"/>
</aura:component>
`;
    const auraMeta = `<?xml version="1.0" encoding="UTF-8" ?>
<AuraDefinitionBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>48.0</apiVersion>
    <description>A Lightning Component Bundle</description>
</AuraDefinitionBundle>
`;
    const auraCss = `.THIS {
}
`;

    const auraDesign = `<design:component label="${auraName}">
    <design:attribute name="recordId" label="Record Id" />
    <design:supportedFormFactors>
        <design:supportedFormFactor type="Large"/>
        <design:supportedFormFactor type="Small"/>
    </design:supportedFormFactors>
</design:component>
`;

    const auraController = `({
    init: function(cmp, event, helper) {
    },
})
`;

    const auraHelper = `({
    help: function(cmp, event) {
    },
})
`;

    const auraPayload = `{
    "message": "Hello World"
}
`;

    const defaultPoc = {
        cmp: auraCmp,
        meta: auraMeta,
        css: auraCss,
        design: auraDesign,
        controller: auraController,
        helper: auraHelper,
        payload: auraPayload,
    };

    return context.autocomplete({
        message: 'Which poc do you want to load?(Choose None to create a new one)',
        source: input => {
            let query = `SELECT Id, Name FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'AuraPOC'`;
            if(input) {
                query += ` AND Name LIKE '%${input}%'`
            }
            query += ' ORDER BY Name ASC LIMIT 20';
            return context.mypim.query(query).then(data => {
                return [ { value: NONE, description: 'Create a new poc' },  ...data.records.map(r => ({ value: r.Name, description: r.Name }))];
            });
        },
    }).then(pocName => {
        let pocPromise = null;
        const setting = {};
        if(pocName === NONE) {
            pocPromise = Promise.resolve({
                setting,
                poc: defaultPoc,
            });
        }
        else {
            pocPromise = context.mypim.query(`SELECT Id, Name, Answer__c FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'AuraPOC' AND Name = '${pocName}'`).then(data => {
                const record = data.records[0];
                setting.recordId = record.Id;
                setting.name = record.Name;

                const poc = JSON.parse(record.Answer__c);
                poc.payload = poc.payload || '{}';

                return {
                    setting,
                    poc,
                };
            });
        }

        return pocPromise.then(({ setting, poc }) => {
            return Promise.all([
                context.fs.mkdir(homeDir + projectName + '/aura/' + fileName, { recursive: true }),
            ]).then(() => {
                return Promise.all([
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.cmp', poc.cmp),
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.cmp-meta.xml', poc.meta),
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.css', poc.css),
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.design', poc.design),
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + 'Controller.js', poc.controller),
                    context.fs.writeFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + 'Helper.js', poc.helper),
                    context.fs.writeFile(homeDir + projectName + '/payload.json', poc.payload),
                    context.fs.writeFile(homeDir + projectName + '/package.xml', packageXml),
                    context.fs.writeFile(homeDir + projectName + '/setting.json', JSON.stringify(setting, null, 4)),
                ]).then(() => {
                    cmd.logSuccess('Done');
                });
            });
        });
    });
})
