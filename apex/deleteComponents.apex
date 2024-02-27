List<practifi__Component__c> cmps = [ SELECT Id FROM practifi__Component__c WHERE practifi__Code__c != null ];
for(practifi__Component__c cmp : cmps) {
    cmp.practifi__Locked__c = false;
}
update cmps;

delete [ SELECT Id FROM practifi__Component_Relation__c WHERE practifi__Code__c != null ];
delete [ SELECT Id FROM practifi__Component__c WHERE practifi__Code__c != null ];
