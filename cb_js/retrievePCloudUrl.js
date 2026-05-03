(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const splitResourceUrl = url => {
        let [protocol, path] = url.split(':/');

        if(!path) {
            path = protocol;
            protocol = '__default__';
        }

        if(protocol === 'pCloud') {
            protocol = '__default__';
        }

        return [protocol, path];
    };

    const escapeApex = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return context.connection.query(`SELECT File_1__c FROM Item__c WHERE Id = '${recordId}'`).then(data => {
        if(!data.records.length) {
            cmd.error('Record not found');
            return;
        }

        const fileUrl = data.records[0].File_1__c;
        if(!fileUrl) {
            cmd.error('File_1__c is empty');
            return;
        }

        const [protocol, path] = splitResourceUrl(fileUrl);
        const logFileName = 'log-' + Date.now() + '.json';

        const apexCode = [
            `String token = GPCloudService.doLogin('${escapeApex(protocol)}');`,
            `Map<String, String> result = GPCloudService.doGetFileToken(token, '${escapeApex(path)}', null);`,
            `String code = result == null ? null : result.get('code');`,
            `insert new ContentVersion(Title = '${logFileName}', PathOnClient = '${logFileName}', VersionData = Blob.valueOf(JSON.serialize(code)));`,
        ].join('\n');

        const exec = new context.ExecuteService(context.connection);
        return exec.executeAnonymous({ apexCode }).then(result => {
            if(!result.success) {
                for(const diagnosticLine of result.diagnostic) {
                    if(result.compiled) {
                        cmd.error(`Line: ${diagnosticLine.lineNumber}, Column: ${diagnosticLine.columnNumber}, Error: ${diagnosticLine.exceptionMessage}`);
                        cmd.error(diagnosticLine.exceptionStackTrace);
                    }
                    else {
                        cmd.error(`Line: ${diagnosticLine.lineNumber}, Column: ${diagnosticLine.columnNumber}, Error: ${diagnosticLine.compileProblem}`);
                    }
                }
                return;
            }

            return context.connection.query(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Title = '${logFileName}' AND IsLatest = true`).then(cvData => {
                if(!cvData.records.length) {
                    cmd.error('Result not found');
                    return;
                }

                const cvId = cvData.records[0].Id;
                const cdId = cvData.records[0].ContentDocumentId;

                return context.connection.request(`/sobjects/ContentVersion/${cvId}/VersionData`).then(versionData => {
                    const code = JSON.parse(versionData);
                    return context.connection.sobject('ContentDocument').delete(cdId).then(() => {
                        if(!code) {
                            cmd.error('Failed to resolve pCloud code');
                            return;
                        }
                        const thumbUrl = `https://api.pcloud.com/getpubthumb?code=${code}&size=960x720&crop=0&type=auto`;
                        cmd.log(thumbUrl);
                        return thumbUrl;
                    });
                });
            });
        });
    });
})
