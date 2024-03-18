const generatePackageXml = buffer => {
    const header = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    ];

    const footer = [
        '    <version>60.0</version>',
        '</Package>',
    ];

    const body = buffer.map(types => generateTypes(types)).flat();

    return [
        ...header,
        ...body,
        ...footer,
    ].join('\n');
};

const generateTypes = types => {
    const header = [
        '    <types>',
    ];

    const footer = [
        '    </types>',
    ];

    const body = types.members.map(member => `        <members>${member}</members>`)
        .concat([ `        <name>${types.name}</name>` ])

    return [
        ...header,
        ...body,
        ...footer,
    ];
};

(function(cmd, context) {
    context.ux.action.start('Generating package.xml');
    return context.connection.metadata.describe().then(data => {
        return Promise.all(data.metadataObjects.map(metadata => {
            return context.connection.metadata.list([ { type: metadata.xmlName } ]).then(data => {
                if(!data || !data.length) return;

                return {
                    name: metadata.xmlName,
                    members: data.map(item => item.fullName),
                };
            });
        })).then(dataList => {
            dataList = dataList.filter(Boolean);
            const buffers = [];
            let count = 0;
            let buffer = [];
            for(const data of dataList) {
                if(count + data.members.length >= 10000) {
                    buffers.push(buffer);

                    count = data.members.length;
                    buffer = [ data ];
                }
                else {
                    count += data.members.length;
                    buffer.push(data);
                }
            }

            if(buffer.length) {
                buffers.push(buffer);
            }

            return Promise.all(buffers.map((buffer, i) => {
                const content = generatePackageXml(buffer);
                return context.fs.writeFile('./package' + (i + 1) + '.xml', content);
            }));
        });
    }).finally(() => context.ux.action.stop());
})
