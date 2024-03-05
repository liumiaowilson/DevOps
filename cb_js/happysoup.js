const DefaultMetadataTypes = [
    {
        label: "Custom Field",
        value: "CustomField",
    },
    {
        label: "Standard Field",
        value: "StandardField",
    },
    {
        label: "Objects & Custom Settings/Metadata Types",
        value: "CustomObject",
    },
    {
        label: "Standard Objects",
        value: "CustomObject",
    },
    {
        label: "Page Layout",
        value: "Layout",
    },
    {
        label: "Custom Button",
        value: "WebLink",
    },
    {
        label: "Field Set",
        value: "FieldSet",
    },
    {
        label: "Apex Trigger",
        value: "ApexTrigger",
    },
    {
        label: "Apex Class",
        value: "ApexClass",
    },
    {
        label: "Visualforce Page",
        value: "ApexPage",
    },
    {
        label: "Visualforce Component",
        value: "ApexComponent",
    },
    {
        label: "Custom Label",
        value: "CustomLabel",
    },
    {
        label: "Validation Rule",
        value: "ValidationRule",
    },
    {
        label: "Flow / Process",
        value: "Flow",
    },
    {
        label: "Email Template",
        value: "EmailTemplate",
    },
    {
        label: "Email Alert",
        value: "WorkflowAlert",
    },
    {
        label: "Lightning Component (Aura)",
        value: "AuraDefinitionBundle",
    }
];

function shouldUseToolingApi(type) {
    const types = [ 'ApexClass', 'EmailTemplate' ];
    return types.includes(type);
}

function getStandardFields() {
    const allFields = [];
    const fieldsByObject = new Map();

    fieldsByObject.set('Opportunity', [
        'StageName',
        'Amount',
        'CloseDate',
        'IsClosed',
        'ForecastCategory',
        'HasOpportunityLineItem',
        'Type',
        'Probability',
        'IsWon',
        'LeadSource',
        ...getCommonFields(),
    ]);

    fieldsByObject.set('Account', [
        'Industry',
        'AccountNumber',
        'AnnualRevenue',
        'IsPersonAccount',
        'Type',
        ...getAddressFields('Billing'),
        ...getAddressFields('Shipping'),
        ...getCommonFields(),
    ]);

    fieldsByObject.set('Case', [
        'ClosedDate',
        'Origin',
        'Priority',
        'Status',
        'Type',
        'Reason',
        'Subject',
        'ContactPhone',
        ...getCommonFields(),
    ]);

    fieldsByObject.set('Contact', [
        'Birthdate',
        'LeadSource',
        ...getAddressFields('Mailing'),
        ...getCommonFields(),
    ]);

    fieldsByObject.set('Lead', [
        'LeadSource',
        'Industry',
        'Status',
        ...getAddressFields(''),
        ...getCommonFields(),
    ]);

    fieldsByObject.set('Product2', [
        'Family',
        'Description',
        'ProductCode',
        'QuantityUnitOfMeasure',
    ]);

    fieldsByObject.set('Campaign', [
        'Status',
        'Type',
        'IsActive',
        'StartDate',
        'EndDate',
    ]);

    fieldsByObject.set('Order', [
        'Status',
        'Type',
        'ActivatedDate',
        'EffectiveDate',
        'EndDate',
    ]);

    fieldsByObject.set('OrderItem', [
        'Quantity',
        'Type',
        'EndDate',
    ]);

    for(const [ object, fields ] of fieldsByObject) {
        fields.forEach(field => {
            const fullName = `${object}.${field}`;
            const fieldObj = { name: fullName, id: fullName };
            allFields.push(fieldObj);
        });
    }

    return allFields;
}

function getCommonFields() {
    return [ 'RecordType', 'Owner' ];
}

function getAddressFields(prefix) {
    const fields = [
        'Accuracy',
        'Address',
        'City',
        'Country',
        'CountryCode',
        'State',
        'StateCode',
        'Street',
        'PostalCode',
        'Longitude',
        'Latitude',
    ]

    fields = fields.map(field => `${prefix}${field}`);

    return fields;
}

const listMetadata = (connection, mdtype) => {
    if(mdtype == 'StandardField'){
        return getStandardFields();
    }
    else if(shouldUseToolingApi(mdtype)){
        const query = `SELECT Id, Name, NamespacePrefix FROM ${mdtype}`;
        return connection.tooling.query(query).then(data => {
            return data.records.map(record => {
                if(record.NamespacePrefix) {
                    record.Name = `${record.NamespacePrefix}.${record.Name}`;
                }

                return {
                    name: record.Name,
                    id: record.Id,
                }
            });
        });
    }
    else {
        return connection.metadata.list([ { type: mdtype } ]).then(data => {
            return (Array.isArray(data) ? data : [ data ]).map(record => {
                return {
                    name: record.fullName,
                    id: record.id || record.fullName,
                };
            });
        });
    }
};

(function(cmd, context) {
    const action = context.argv[0];

    if(!['usage', 'dependency'].includes(action)) {
        cmd.error('Action is required: usage or dependency');
        return;
    }

    return context.autocomplete({
        message: 'Which metadata type do you want to check?',
        source: input => {
            return DefaultMetadataTypes.filter(mt => input ? (mt.label.toLowerCase().includes(input.toLowerCase()) || mt.value.toLowerCase().includes(input.toLowerCase())) : true).map(mt => ({ value: mt.value, description: mt.label }));
        },
    }).then(mdtype => {
        return listMetadata(context.connection, mdtype).then(metadataTypes => {
            return context.autocomplete({
                message: 'Which item do you want to check?',
                source: input => {
                    return metadataTypes.filter(mt => input ? mt.name.toLowerCase().includes(input.toLowerCase()) : true).map(mt => ({ value: mt.name, description: mt.id })).sort((a, b) => a.value.localeCompare(b.value));
                },
            }).then(mdName => {
                const md = metadataTypes.find(mt => mt.name === mdName);

                const entryPoint = {
                    name: md.name,
                    type: mdtype,
                    id: md.id,
                };

                const connection = {
                    token: context.connection.accessToken,
                    url: context.connection.instanceUrl,
                    apiVersion: context.connection.version,
                };

                return context.require('sfdc-soup').then(({ default: sfdcSoup }) => {
                    const soupApi = sfdcSoup(connection, entryPoint);
                    if(action === 'usage') {
                        context.ux.action.start('Calculating Usage');
                        return soupApi.getUsage().then(response => {
                            const data = response.datatable.data.map(item => {
                                return {
                                    id: item.id,
                                    type: item.type,
                                    name: item.namespace ? item.namespace + '__' + item.name : item.name,
                                    attributes: item.attributes,
                                    url: '[m://' + item.id + ']',
                                };
                            });

                            context.ux.table(data, {
                                type: {},
                                name: {},
                                attributes: {},
                                url: {},
                            });

                            return response;
                        }).finally(() => context.ux.action.stop());
                    }
                    else {
                        context.ux.action.start('Calculating Dependencies');
                        return soupApi.getDependencies().then(response => {
                            const data = response.datatable.data.map(item => {
                                return {
                                    id: item.id,
                                    type: item.type,
                                    name: item.namespace ? item.namespace + '__' + item.name : item.name,
                                    attributes: item.attributes,
                                    url: '[m://' + item.id + ']',
                                };
                            });

                            context.ux.table(data, {
                                type: {},
                                name: {},
                                attributes: {},
                                url: {},
                            });

                            return response;
                        }).finally(() => context.ux.action.stop());
                    }
                });
            });
        });
    });
})
