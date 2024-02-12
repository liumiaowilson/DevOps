(function(cmd, context) {
    const groupId = context.argv[0];
    if(!groupId) {
        cmd.error('Group Id is required');
        return;
    }

    return Promise.all([
        context.connection.query(`SELECT Id, DeveloperName, Type FROM Group`),
        context.connection.query(`SELECT GroupId, UserOrGroupId FROM GroupMember`),
        context.connection.query(`SELECT Id, Name, Username FROM User`),
    ]).then(([ groupData, groupMemberData, userData ]) => {
        const groupMap = {};
        for(const group of groupData.records) {
            groupMap[group.Id] = {
                id: group.Id,
                name: `${group.DeveloperName}(${group.Type})`,
            };
        }

        const groupMemberMap = {};
        for(const groupMember of groupMemberData.records) {
            const members = groupMemberMap[groupMember.GroupId] || [];
            members.push(groupMember.UserOrGroupId);
            groupMemberMap[groupMember.GroupId] = members;
        }

        const userMap = {};
        for(const user of userData.records) {
            userMap[user.Id] = {
                id: user.id,
                name: `${user.Name}(${user.Username})`,
            };
        }

        const buildGroup = groupId => {
            const tree = context.ux.tree();
            const members = groupMemberMap[groupId] || [];
            for(const member of members) {
                if(userMap[member]) {
                    tree.insert(userMap[member].name);
                }
                else if(groupMap[member]) {
                    tree.insert(groupMap[member].name, groupMap[member].id);
                }
            }

            return tree;
        };

        const root = context.ux.tree();
        if(userMap[groupId]) {
            root.insert(userMap[groupId].name);
        }
        else if(groupMap[groupId]) {
            root.insert(groupMap[groupId].name, buildGroup(groupId));
        }

        root.display();
    });
})
