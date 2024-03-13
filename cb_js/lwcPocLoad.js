(function(cmd, context) {
    const NONE = '--None--';
    const lwcName = 'TestLwcPOC4921';
    const fileName = lwcName[0].toLowerCase() + lwcName.substring(1);
    const homeDir = context.env.getString('CODE_BUILDER_HOME') + '/';
    const projectName = 'LwcPoc';

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>*</members>
        <name>LightningComponentBundle</name>
    </types>
    <version>60</version>
</Package>`;

    const lwcHtml = `<template>
    <div>{message}</div>
</template>
`;

    const lwcJs = `import {
    LightningElement,
    api,
} from 'lwc';

export default class ${lwcName} extends LightningElement {
    @api message = 'Hello World';
}
`;

    const lwcMeta = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60</apiVersion>
    <isExposed>false</isExposed>
</LightningComponentBundle>
`;

    const lwcCss = `.red { color: red }`;

    const lwcPayload = `{
    "message": "Hello World"
}
`;

    const defaultPoc = {
        js: lwcJs,
        meta: lwcMeta,
        html: lwcHtml,
        css: lwcCss,
        payload: lwcPayload,
    };

    return context.autocomplete({
        message: 'Which poc do you want to load?(Choose None to create a new one)',
        source: input => {
            let query = `SELECT Id, Name FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'LwcPOC'`;
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
            pocPromise = context.mypim.query(`SELECT Id, Name, Answer__c FROM Item__c WHERE Type__c = 'PlainText' AND Parent__r.Name = 'LwcPOC' AND Name = '${pocName}'`).then(data => {
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
                context.fs.mkdir(homeDir + projectName + '/lwc/' + fileName, { recursive: true }),
            ]).then(() => {
                return Promise.all([
                    context.fs.writeFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.js', poc.js),
                    context.fs.writeFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.js-meta.xml', poc.meta),
                    context.fs.writeFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.html', poc.html),
                    context.fs.writeFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.css', poc.css),
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
