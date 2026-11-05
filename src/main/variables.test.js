const assert = require("assert");
const {
  ExecutionVariables,
  resolveActionFields,
  resolveTemplate,
  validateVariableName,
  validateVariableValue,
} = require("./variables.js");

function testValidNames() {
  for (const name of ["counter", "user_name", "attempt2", "isRunning", "a", "A".repeat(32)]) {
    assert.strictEqual(validateVariableName(name).valid, true, `${name} should be valid`);
  }
}

function testInvalidNames() {
  const cases = ["2counter", "user-name", "foo.bar", "{{test}}", "", "A".repeat(33), "__proto__", "prototype", "constructor"];
  for (const name of cases) {
    assert.strictEqual(validateVariableName(name).valid, false, `${name} should be invalid`);
  }
}

function testValueValidation() {
  assert.strictEqual(validateVariableValue("string", "hello").valid, true);
  assert.strictEqual(validateVariableValue("string", "x".repeat(10001)).valid, false);
  assert.strictEqual(validateVariableValue("number", "42").value, 42);
  assert.strictEqual(validateVariableValue("number", NaN).valid, false);
  assert.strictEqual(validateVariableValue("number", Infinity).valid, false);
  assert.strictEqual(validateVariableValue("boolean", true).valid, true);
  assert.strictEqual(validateVariableValue("boolean", "true").value, true);
  assert.strictEqual(validateVariableValue("boolean", "maybe").valid, false);
  assert.strictEqual(validateVariableValue("object", {}).valid, false);
}

function testTemplateResolution() {
  const variables = new ExecutionVariables();
  variables.set("name", "Swipey");
  variables.set("counter", 3);
  variables.set("enabled", true);

  assert.strictEqual(resolveTemplate("Hello {{name}}", variables), "Hello Swipey");
  assert.strictEqual(resolveTemplate("{{name}} is {{counter}} ({{enabled}})", variables), "Swipey is 3 (true)");
  assert.strictEqual(resolveTemplate("{{name}} and {{name}} again", variables), "Swipey and Swipey again");
  assert.strictEqual(resolveTemplate("no templates here", variables), "no templates here");

  assert.throws(() => resolveTemplate("Hello {{missing}}", variables), (error) => error.code === "VARIABLE_NOT_FOUND");
  try {
    resolveTemplate("Hello {{missing}}", variables);
    assert.fail("should have thrown");
  } catch (error) {
    assert.strictEqual(error.code, "VARIABLE_NOT_FOUND");
    assert.strictEqual(error.details.variableName, "missing");
  }
}

function testTemplateSafety() {
  const variables = new ExecutionVariables();
  variables.set("name", "{{name}}");
  // Verschachtelte Platzhalter in einem ersetzten Wert werden nicht nochmal ausgewertet.
  assert.strictEqual(resolveTemplate("{{name}}", variables), "{{name}}");
  // Property-Zugriffe wie {{foo.bar}} werden nie erkannt und bleiben als Text stehen.
  assert.strictEqual(resolveTemplate("{{foo.bar}}", variables), "{{foo.bar}}");
  // Gefährliche Prototype-Keys gibt es im Store nie (Map), sie zählen als fehlende
  // Variablen und kommen nicht an Object.prototype heran.
  assert.throws(() => resolveTemplate("{{constructor}}", variables), (error) => error.code === "VARIABLE_NOT_FOUND");
  // "__proto__" passt gar nicht auf das Namensmuster (muss mit einem Buchstaben anfangen)
  // und bleibt deshalb einfach als Text stehen.
  assert.strictEqual(resolveTemplate("{{__proto__}}", variables), "{{__proto__}}");
}

function testResolveActionFields() {
  const variables = new ExecutionVariables();
  variables.set("query", "cats");
  const resolved = resolveActionFields({ query: "search for {{query}}", other: 5 }, ["query"], variables);
  assert.strictEqual(resolved.query, "search for cats");
  assert.strictEqual(resolved.other, 5);
}

function testExecutionVariablesIsolation() {
  const a = new ExecutionVariables();
  const b = new ExecutionVariables();
  a.set("x", 1);
  assert.strictEqual(b.has("x"), false);
  assert.deepStrictEqual(a.names(), ["x"]);
}

function run() {
  testValidNames();
  testInvalidNames();
  testValueValidation();
  testTemplateResolution();
  testTemplateSafety();
  testResolveActionFields();
  testExecutionVariablesIsolation();
  console.log("variables tests passed");
}

run();
