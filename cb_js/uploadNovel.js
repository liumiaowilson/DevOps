(function(cmd, context) {
    const NOVEL_PARENT_ID = 'a041U00000RutM9QAJ';
    const FIELD_MAX = 131072;
    const CHUNK_MAX = FIELD_MAX * 2;

    const filePath = context.argv[0];

    if(!filePath) {
        cmd.error('File path is required');
        return;
    }

    return context.require('path').then(({ default: path }) => {
        const name = path.basename(filePath, path.extname(filePath));

        return context.fs.readFile(filePath, 'utf8').then(content => {
            if(!content || !content.trim()) {
                cmd.error('File is empty');
                return;
            }

            const chunks = [];
            for(let i = 0; i < content.length; i += CHUNK_MAX) {
                chunks.push(content.substring(i, i + CHUNK_MAX));
            }

            context.ux.action.start('Uploading ' + chunks.length + ' chunk(s) for ' + name);

            return chunks.reduce((prev, chunk, n) => prev.then(() => {
                const chunkName = chunks.length === 1 ? name : name + ' (' + (n + 1) + ')';
                context.ux.action.start('Uploading ' + chunkName);
                return context.mypim.sobject('Item__c').create({
                    Name: chunkName,
                    Type__c: 'PlainText',
                    Parent__c: NOVEL_PARENT_ID,
                    Question__c: chunk.substring(0, FIELD_MAX),
                    Answer__c: chunk.substring(FIELD_MAX),
                }).then(result => {
                    cmd.log('Uploaded ' + chunkName + ' (' + (result.id || result.Id) + ')');
                }).catch(err => {
                    throw new Error('Upload failed at chunk ' + (n + 1) + ': ' + err.message);
                });
            }), Promise.resolve()).then(() => {
                cmd.logSuccess('Uploaded ' + chunks.length + ' chunk(s) for ' + name);
            }).finally(() => context.ux.action.stop());
        });
    });
})
