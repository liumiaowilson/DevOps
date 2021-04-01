SObjectType sObjType = practifi__PractiFI_Trigger_Setting__c.sObjectType;
Schema.DescribeSObjectResult typeDesc = sObjType.getDescribe();
Map<String, Schema.SObjectField> fieldMap = typeDesc.fields.getMap();

practifi__PractiFI_Trigger_Setting__c setting = new practifi__PractiFI_Trigger_Setting__c();
for(String fieldName : fieldMap.keySet()) {
    Schema.SObjectField field = fieldMap.get(fieldName);
    Schema.DescribeFieldResult fieldDesc = field.getDescribe();
	Object defaultValue = fieldDesc.getDefaultValue();
    if(defaultValue != null && fieldDesc.isUpdateable()) {
        setting.put(fieldName, defaultValue);
    }
}

insert setting;
