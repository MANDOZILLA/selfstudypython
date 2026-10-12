const makeSuite = (concept, fixtures) => String.raw`
import ast, json, traceback
checks = []
def check(i, ok, detail=''):
    entry = {'id': i, 'name': i, 'required': True, 'passed': bool(ok), 'detail': detail}
    for index, existing in enumerate(checks):
        if existing['id'] == i:
            checks[index] = entry
            return
    checks.append(entry)
for i in ${JSON.stringify([concept, ...fixtures.map(x => x[0])])}:
    check(i, False, 'Submission did not complete the check.')
try:
    tree = ast.parse(submission_source)
    node = next((n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'solve'), None)
    if node is None: raise ValueError('Define solve.')
    ns = {'__name__': '__submission__'}
    exec(compile(tree, 'main.py', 'exec'), ns)
    solve = ns['solve']
    check(${JSON.stringify(concept)}, True)
except BaseException:
    grade_result = {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
else:
`; // fixture calls are appended below by suite()

const suite = (concept, fixtures) => makeSuite(concept, fixtures) + fixtures.map(([id, cases]) => `
errors = []
for args, expected in json.loads(${JSON.stringify(JSON.stringify(cases))}):
    try:
        actual = solve(*args)
        if type(actual) is not type(expected) or actual != expected:
            errors.append('expected ' + repr(expected) + ', got ' + repr(actual))
    except BaseException:
        errors.append(traceback.format_exc())
check(${JSON.stringify(id)}, not errors, '\\n'.join(errors))
`.trim().split('\n').map(line => '    ' + line).join('\n') + '\n').join('') + `
    grade_result = {'executionOk': True, 'tests': checks, 'error': ''}
json.dumps(grade_result)
`;

const definitions = {
  "first-steps-guided-v1": ["basics-concept", [["sample", [[["Ada", 36], "Hi Ada, next year you will be 37"]]], ["number", [[["Sam", 0], "Hi Sam, next year you will be 1"]]], ["string", [[["Lin", 99], "Hi Lin, next year you will be 100"]]]]],
  "first-steps-project-v1": ["basics-concept", [["sample", [[["Tea", 2.5, 3], "Tea: 3 x $2.50 = $7.50"]]], ["integer-count", [[["Pen", 1, 4], "Pen: 4 x $1.00 = $4.00"]]], ["format", [[["Book", 3.125, 2], "Book: 2 x $3.12 = $6.25"]]]]],
  "making-decisions-guided-v1": ["conditions", [["sample", [[[15], "mild"]]], ["boundary-low", [[[9], "cold"], [[10], "mild"]]], ["boundary-high", [[[24], "mild"], [[25], "hot"]]]]],
  "making-decisions-project-v1": ["conditions", [["sample", [[[18, true], 9]]], ["age-boundaries", [[[4, false], 0], [[5, false], 8], [[17, true], 8], [[18, false], 12]]], ["student", [[[30, true], 9], [[30, false], 12]]]]],
  "loops-guided-v1": ["loops", [["sample", [[[3], 6]]], ["zero", [[[0], 0]]], ["larger", [[[10], 55]]]]],
  "loops-project-v1": ["loops", [["sample", [[[5], ["1", "2", "Fizz", "4", "Buzz"]]]], ["multiples", [[[15], ["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"]]]], ["zero", [[[0], []]]]]],
  "lists-and-strings-guided-v1": ["lists-and-strings", [["sample", [[[ [" Ada ", "", " Lin "] ], ["Ada", "Lin"]]]], ["empty", [[ [[]], []]]], ["original-order", [[[[" z ", "a "]], ["z", "a"]]]]]],
  "lists-and-strings-project-v1": ["lists-and-strings", [["sample", [[[" Hi hi "], {"text":"Hi hi", "words":["hi","hi"],"count":2,"unique":1}]]], ["empty", [[["   "], {"text":"", "words":[],"count":0,"unique":0}]]], ["repeated", [[["One two one"], {"text":"One two one", "words":["one","two","one"],"count":3,"unique":2}]]]]]
};

export const BASICS_1_SUITES = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, [concept, fixtures]]) => [id, suite(concept, fixtures)])));
export const BASICS_1_CATALOG = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, [concept, fixtures]]) => [id, Object.freeze({ exerciseId: id.replace(/-v1$/, ''), version: '1.0.0', requiredTests: [concept, ...fixtures.map(x => x[0])] })])));
