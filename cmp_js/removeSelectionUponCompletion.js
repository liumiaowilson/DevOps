(function(json, context) {
    const targetActionNames = [ 'Complete Tasks', 'Deep Delete', 'Cancel Service', 'Cancel Process' ];

    if(json.component?.attributes?.componentType === 'table') {
        const tableMassActions = json.component?.properties?.tableMassActions;
        if(tableMassActions) {
            json.component.properties.tableMassActions = tableMassActions.map(action => {
                if(targetActionNames.includes(action.label)) {
                    if(action.params && !action.params.removeSelectionUponCompletion) {
                        action.params.removeSelectionUponCompletion = true;
                    }
                }

                return action;
            });
        }
    }

    return json;
})
