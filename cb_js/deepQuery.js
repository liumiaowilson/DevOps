const clone = obj => JSON.parse(JSON.stringify(obj));

class Node {
    constructor(connection, soqlParser, cmd) {
        this.connection = connection;
        this.soqlParser = soqlParser;
        this.cmd = cmd;

        this.ast = null;
        this.parentFieldName = null;
        this.children = {};
        this.data = null;
    }

    init(ast, parentFieldName) {
        this.ast = clone(ast);
        this.ast.fields = this.ast.fields.filter(field => field.type !== 'FieldSubquery');
        this.parentFieldName = parentFieldName;

        if(this.parentFieldName && !this.ast.fields.find(field => field.field === this.parentFieldName)) {
            this.ast.fields.push({
                type: 'Field',
                field: this.parentFieldName,
            });
        }

        const subQueries = ast.fields.filter(field => field.type === 'FieldSubquery');
        const objectApiName = this.ast.sObject;

        return this.connection.describe(objectApiName).then(objDescribe => {
            const childRelationshipMap = {};
            for(const childRelationship of objDescribe.childRelationships) {
                if(!childRelationship.relationshipName) continue;

                childRelationshipMap[childRelationship.relationshipName] = childRelationship;
            }

            const query = this.soqlParser.composeQuery(this.ast);
            return this.connection.query(query).then(data => {
                this.data = data;

                if(!this.data.records.length) return;

                return Promise.all(subQueries.map(subQuery => {
                    const subAst = clone(subQuery.subquery);
                    const relationshipName = subAst.relationshipName;
                    delete subAst.relationshipName;
                    const childRelationship = childRelationshipMap[relationshipName];
                    if(!childRelationship) {
                        throw new Error('Invalid child relationship name: ' + relationshipName + ' for ' + objectApiName);
                    }

                    const parentFieldName = childRelationship.field;
                    subAst.sObject = childRelationship.childSObject;

                    const idClause = {
                        field: parentFieldName,
                        operator: "IN",
                        literalType: "STRING",
                        value: this.data.records.map(record => "'" + record.Id + "'"),
                    };

                    if(!subAst.where) {
                        subAst.where = {
                            left: idClause,
                        };
                    }
                    else {
                        subAst.where = {
                            left: idClause,
                            operator: 'AND',
                            right: subAst.where,
                        };
                    }

                    const child = new Node(this.connection, this.soqlParser, this.cmd);
                    this.children[relationshipName] = child;
                    return child.init(subAst, parentFieldName);
                }));
            });
        });
    }

    reconcile() {
        Object.keys(this.children).forEach(key => {
            const child = this.children[key];
            for(const record of this.data.records) {
                const childRecords = [];
                for(const childRecord of child.data.records) {
                    if(childRecord[child.parentFieldName] === record.Id) {
                        childRecords.push(childRecord);
                    }
                }

                record[key] = {
                    totalSize: childRecords.length,
                    done: true,
                    records: childRecords,
                };
            }

            child.reconcile();
        });
    }
}

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    context.ux.action.start('Querying');
    return context.fs.readFile(path, 'utf8').then(query => {
        return context.require('soql-parser-js').then(({ default: soqlParser }) => {
            const ast = soqlParser.parseQuery(query);
            const root = new Node(context.connection, soqlParser, cmd);
            return root.init(ast, null).then(() => {
                root.reconcile();

                cmd.log(JSON.stringify(root.data, null, 4));

                return root.data;
            });
        });
    }).finally(() => context.ux.action.stop());
})
