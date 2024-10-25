(function(cmd, context) {
    const processRecordTreeFile = context.argv[0];
    if(!processRecordTreeFile) {
        cmd.error('Process Record Tree File is required');
        return;
    }

    return context.fs.readFile(processRecordTreeFile, 'utf8').then(content => {
        const root = JSON.parse(content);

        const iterate = (node, fn) => {
            if(Array.isArray(node)) {
                node.forEach(n => iterate(n, fn));
            }
            else if(node && typeof node === 'object' && node.constructor === Object) {
                fn(node);
                Object.values(node).forEach(n => iterate(n, fn));
            }
        };

        const processTaskMaps = {};
        const activeFormFieldMaps = {};
        const activeFormFieldToProcessTaskMap = {};
        const activeFormFieldPrefilledByMap = {};
        const processTaskPrefillMaps = {};
        iterate(root, node => {
            if(!node.attributes) {
                return;
            }

            if(node.attributes.type === 'practifi__Process_Task__c') {
                processTaskMaps[node.Id] = node.practifi__Subject__c;
            }
            else if(node.attributes.type === 'practifi__Active_Form_Field__c') {
                activeFormFieldMaps[node.Id] = node.Name;
                activeFormFieldToProcessTaskMap[node.Id] = node.practifi__Process_Task__c;

                if(node.practifi__Prefill_This_Field__c === 'With a value from another Active Form Field in this workflow') {
                    activeFormFieldPrefilledByMap[node.Id] = node.practifi__Prefill_Form_Field__c;
                }
            }
        });

        Object.keys(activeFormFieldPrefilledByMap).forEach(key => {
            const prefillKey = activeFormFieldPrefilledByMap[key];
            const processKey = activeFormFieldToProcessTaskMap[key];
            const prefillProcessKey = activeFormFieldToProcessTaskMap[prefillKey];

            const prefills = processTaskPrefillMaps[processKey] || [];
            if(!prefills.includes(prefillProcessKey)) {
                prefills.push(prefillProcessKey);
            }
            processTaskPrefillMaps[processKey] = prefills;
        });

        Object.keys(processTaskPrefillMaps).forEach(key => {
            const prefillKeys = processTaskPrefillMaps[key];
            const subject = processTaskMaps[key];
            const prefillSubjects = prefillKeys.map(prefillKey => processTaskMaps[prefillKey]);

            cmd.log('============');
            cmd.log(`Process Task: ${subject}`);
            cmd.log(`Prefilled by: ${prefillSubjects.join(', ')}`);
        });
    });
})
