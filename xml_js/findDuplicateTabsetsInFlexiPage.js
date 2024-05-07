(function(root, cmd, context) {
    const flexiPageRegions = root.FlexiPage.flexiPageRegions;
    Array.from(flexiPageRegions || []).forEach(region => {
        const tabsets = [];

        Array.from(region.itemInstances || []).forEach(itemInstance => {
            if(itemInstance.componentInstance?.componentName._text === 'flexipage:tabset' &&
                itemInstance.componentInstance?.visibilityRule) {
                tabsets.push(itemInstance.componentInstance.identifier);
            }
        });

        if(tabsets.length > 1) {
            cmd.log(root.FlexiPage.masterLabel._text);
        }
    });
})
