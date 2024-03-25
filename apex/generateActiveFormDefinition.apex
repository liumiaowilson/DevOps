Savepoint sp = Database.setSavepoint();

Task t = new Task(
    Subject='Test',
    Priority='Low',
    practifi__Process_Task__c='{{recordId}}'
);

insert t;

List<Task> tasks = [ SELECT Id, practifi__Activity_Configuration__r.practifi__Form_Definition__c FROM Task WHERE Id = :t.Id ];
t = tasks[0];

Database.rollback(sp);

return JSON.deserializeUntyped(t.practifi__Activity_Configuration__r.practifi__Form_Definition__c);
