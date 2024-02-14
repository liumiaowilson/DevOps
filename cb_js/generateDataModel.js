(function(cmd, context) {
    const lines = [];
    lines.push('---');
    lines.push('title: Data Model');
    lines.push('---');
    lines.push('erDiagram');

    const objectApiNames = context.argv;
    if(!objectApiNames.length) {
        cmd.error('No object api names are provided');
        return;
    }

    return Promise.all(objectApiNames.map(objectApiName => context.connection.describe(objectApiName))).then(objectDescribes => {
        for(const objectDescribe of objectDescribes) {
            for(const childRelationship of objectDescribe.childRelationships) {
                if(!objectApiNames.includes(childRelationship.childSObject)) {
                    continue;
                }
                if(!childRelationship.relationshipName) {
                    continue;
                }

                const relationshipName = childRelationship.relationshipName;
                lines.push('    ' + objectDescribe.name + ' ||--|{ ' + childRelationship.childSObject + ' : ' + relationshipName);
            }
        }

        const result = lines.join('\n');
        cmd.log(result);
        return result;
    });
})
