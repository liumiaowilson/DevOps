(function(cmd, context) {
    const NONE = '--None--';
    const pageName = 'TestVfPagePOC4735';
    const controllerName = pageName + 'Controller';
    const fileName = pageName[0].toLowerCase() + pageName.substring(1);
    const homeDir = '/home/codebuilder/';
    const projectName = 'VfPagePoc';

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>*</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>ApexPage</name>
    </types>
    <version>60</version>
</Package>`;

    const page = `<apex:page
    controller="${controllerName}"
    showHeader="false"
    showChat="false"
    sideBar="false"
    applyHtmlTag="false"
    applyBodyTag="false"
>
    {!value}
</apex:page>
`;

    const pageMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60</apiVersion>
    <availableInTouch>false</availableInTouch>
    <confirmationTokenRequired>false</confirmationTokenRequired>
    <label>${pageName}</label>
</ApexPage>
`;

    const controller = `public with sharing class ${controllerName} {
    public Object getValue() {
        return 'Hello World';
    }
}
`;

    const controllerMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60</apiVersion>
    <status>Active</status>
</ApexClass>
`;

    const defaultPoc = {
        page,
        pageMeta,
        controller,
        controllerMeta,
    };

    return context.autocomplete({
        message: 'Which poc do you want to load?(Choose None to create a new one)',
        source: input => {
            let query = `SELECT Id, Name FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'VfPagePOC'`;
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
            pocPromise = context.mypim.query(`SELECT Id, Name, Answer__c FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'VfPagePOC' AND Name = '${pocName}'`).then(data => {
                const record = data.records[0];
                setting.recordId = record.Id;
                setting.name = record.Name;
                return {
                    setting,
                    poc: JSON.parse(record.Answer__c),
                };
            });
        }

        return pocPromise.then(({ setting, poc }) => {
            return Promise.all([
                context.fs.mkdir(homeDir + projectName + '/pages', { recursive: true }),
                context.fs.mkdir(homeDir + projectName + '/classes', { recursive: true }),
            ]).then(() => {
                return Promise.all([
                    context.fs.writeFile(homeDir + projectName + '/pages/' + fileName + '.page', poc.page),
                    context.fs.writeFile(homeDir + projectName + '/pages/' + fileName + '.page-meta.xml', poc.pageMeta),
                    context.fs.writeFile(homeDir + projectName + '/classes/' + controllerName + '.cls', poc.controller),
                    context.fs.writeFile(homeDir + projectName + '/classes/' + controllerName + '.cls-meta.xml', poc.controllerMeta),
                    context.fs.writeFile(homeDir + projectName + '/package.xml', packageXml),
                    context.fs.writeFile(homeDir + projectName + '/setting.json', JSON.stringify(setting, null, 4)),
                ]).then(() => {
                    cmd.logSuccess('Done');
                });
            });
        });
    });
})
