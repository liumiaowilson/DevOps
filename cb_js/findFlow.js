(function(cmd, context) {
    return context.connection.query('SELECT Id, ApiName, NamespacePrefix, Label, ProcessType, TriggerType, RecordTriggerType, TriggerObjectOrEventLabel FROM FlowDefinitionView').then(data => {
        const options = data.records.map(flow => {
            const value = (flow.NamespacePrefix ? flow.NamespacePrefix + '__' : '') + flow.ApiName + ':' + flow.Id;
            const description = flow.Label + '(' + flow.ProcessType + '[' + [ flow.TriggerType, flow.RecordTriggerType, flow.TriggerObjectOrEventLabel ].filter(Boolean).join('-') + '])';
            return {
                value,
                description,
            };
        });

        return context.autocomplete({
            message: 'Which flow do you want to find?',
            source: input => {
                input = input?.toLowerCase();

                return options.filter(option => {
                    if(!input) {
                        return true;
                    }

                    return option.value.toLowerCase().includes(input) || option.description.toLowerCase().includes(input);
                });
            },
        }).then(selected => {
            let [ ,flowId ] = selected.split(':');
            flowId = '300' + flowId.substring(3);
            const url = `${context.connection.instanceUrl}/lightning/setup/Flows/page?address=%2F${flowId}`;
            context.open(url);
            return flowId;
        });
    });
})
