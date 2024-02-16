(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Approval Processes');
    return context.connection.request('/process/approvals').then(data => {
        let records = [];
        if(data.approvals && data.approvals[objectApiName]) {
            records = data.approvals[objectApiName];
        }

        const approvals = records.map(record => {
            return {
                id: record.id,
                name: record.name,
                url: '[m://approvalProcess/' + record.id + ']',
            };
        });

        if(approvals.length) {
            cmd.styledHeader('# Approval Processes');
            context.ux.table(approvals, {
                name: {},
                url: {},
            });
        }

        return approvals;
    });
})
