const flowNames = new Set();

(function(json, context, cmd, cmpName) {
    context.registerCallbacks({
        onComplete: (cmd, context) => {
            const result = [ ...flowNames ].sort();
            result.forEach(flowName => cmd.log(flowName));
        },
    });

    if(json.tableMassActions) {
        json.tableMassActions.forEach(action => {
            if(action.type === 'flow') {
                flowNames.add(action.params.flowName);
            }
        });
    }

    return json;
})
