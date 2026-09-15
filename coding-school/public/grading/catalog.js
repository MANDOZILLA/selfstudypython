export const paymentsCsv = 'id,amount,currency\n pay_101 ,12.00, usd \npay_102,,USD\npay_103,0.10,EUR\npay_101,90.00,USD\npay_104,-1.00,GBP\n';
export const graderCatalog = Object.freeze({
  "payments-csv-v1": Object.freeze({ exerciseId: "messy-csv-challenge", version: "1.2.0", requiredTests: ["concept-csv", "concept-decimal", "sample", "empty", "header", "precision", "invalid", "duplicates", "quoted", "shape"] }),
  "api-normalization-v1": Object.freeze({ exerciseId: "api-normalization-challenge", version: "1.0.0", requiredTests: ["concept-json", "concept-decimal", "sample", "empty", "envelope", "malformed", "types", "mixed", "precision", "invalid", "duplicates", "shape"] }),
  "contacts-v1": Object.freeze({ exerciseId: "contacts-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "duplicates", "shape"] }),
  "inventory-v1": Object.freeze({ exerciseId: "inventory-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "duplicates", "shape"] }),
  "csv-tags-v1": Object.freeze({ exerciseId: "csv-tags-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "header", "quoted", "invalid"] }),
  "invoice-cents-v1": Object.freeze({ exerciseId: "invoice-cents-challenge", version: "1.0.0", requiredTests: ["sample", "precision", "invalid"] }),
  "webhook-events-v1": Object.freeze({ exerciseId: "webhook-events-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "envelope", "invalid", "duplicates"] }),
  "settlement-reconciliation-v1": Object.freeze({ exerciseId: "settlement-reconciliation-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "envelope", "malformed", "types", "header", "invalid", "duplicates", "join"] }),
  "diagnostic-call-forms-v1": Object.freeze({ exerciseId: "diagnostic-call-forms", version: "1.0.0", requiredTests: ["concept-loads", "concept-map", "sample", "empty", "invalid"] }),
  "diagnostic-http-v1": Object.freeze({ exerciseId: "diagnostic-http", version: "1.0.0", requiredTests: ["boundary-199", "boundary-200", "boundary-299", "boundary-300"] }),
  "diagnostic-files-v1": Object.freeze({ exerciseId: "diagnostic-files", version: "1.0.0", requiredTests: ["reads-lines", "context-manager", "missing-file"] }),
  "traceback-v1": Object.freeze({ exerciseId: "traceback-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "chained", "syntax"] }),
  "logscan-v1": Object.freeze({ exerciseId: "logscan-challenge", version: "1.0.0", requiredTests: ["concept-open", "concept-with", "sample", "empty", "invalid", "shape"] }),
  "validators-v1": Object.freeze({ exerciseId: "validators-challenge", version: "1.0.0", requiredTests: ["concept-reuse", "sample", "empty", "invalid", "shape"] }),
  "transform-v1": Object.freeze({ exerciseId: "transform-challenge", version: "1.0.0", requiredTests: ["concept-comprehension", "sample", "empty", "invalid", "precision", "shape"] }),
  "pandas-clean-v1": Object.freeze({ exerciseId: "pandas-clean-challenge", version: "1.0.0", packages: ["pandas"], requiredTests: ["concept-pandas", "sample", "empty", "invalid", "missing", "shape"] }),
  "pandas-project-v1": Object.freeze({ exerciseId: "pandas-quality-project", version: "1.0.0", packages: ["pandas"], requiredTests: ["concept-pandas", "sample", "empty", "invalid", "missing", "shape"] }),
  "sqlite-agg-v1": Object.freeze({ exerciseId: "sqlite-agg-challenge", version: "1.0.0", requiredTests: ["concept-sqlite", "sample", "empty", "missing", "shape"] }),
  "sqlite-project-v1": Object.freeze({ exerciseId: "sqlite-project-challenge", version: "1.0.0", requiredTests: ["concept-sqlite", "concept-transaction", "sample", "empty", "committed", "shape"] }),
  "money-recon-v1": Object.freeze({ exerciseId: "money-recon-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "anomaly", "shape"] }),
  "money-project-v1": Object.freeze({ exerciseId: "money-project-challenge", version: "1.0.0", packages: ["pandas"], requiredTests: ["concept-pandas", "sample", "empty", "invalid", "anomaly", "shape"] }),
  "http-client-v1": Object.freeze({ exerciseId: "http-client-challenge", version: "1.0.0", requiredTests: ["boundary-199", "boundary-200", "boundary-299", "boundary-300", "retry-after", "retries", "no-retry-client-error", "exhausted"] }),
  "http-project-v1": Object.freeze({ exerciseId: "http-project-challenge", version: "1.0.0", requiredTests: ["pagination", "retries", "page-limit", "unrecoverable", "shape"] }),
  "llm-guard-v1": Object.freeze({ exerciseId: "llm-guard-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "schema", "deterministic", "shape"] }),
  "llm-project-v1": Object.freeze({ exerciseId: "llm-project-challenge", version: "1.0.0", requiredTests: ["passthrough", "retry", "invalid-body", "exhausted", "shape"] }),
  "recovery-project-v1": Object.freeze({ exerciseId: "recovery-project-challenge", version: "1.0.0", requiredTests: ["concept-open", "concept-with", "sample", "no-crash", "empty", "missing", "shape"] }),
  "validation-project-v1": Object.freeze({ exerciseId: "validation-project-challenge", version: "1.0.0", requiredTests: ["concept-reuse", "sample", "empty", "invalid", "reasons", "shape"] }),
  "transform-project-v1": Object.freeze({ exerciseId: "transform-project-challenge", version: "1.0.0", requiredTests: ["concept-comprehension", "sample", "empty", "invalid", "precision", "shape"] }),
  "foundations-debug-v1": Object.freeze({ exerciseId: "foundations-debug-challenge", version: "1.0.0", requiredTests: ["concept-except", "sample", "empty", "invalid", "types", "shape"] }),
  "foundations-scratch-v1": Object.freeze({ exerciseId: "foundations-scratch-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "invalid", "shape"] }),
  "foundations-project-v1": Object.freeze({ exerciseId: "foundations-project-challenge", version: "1.0.0", requiredTests: ["concept-with", "sample", "empty", "malformed", "case", "shape", "missing-file"] }),
  "foundations-read-v1": Object.freeze({ exerciseId: "foundations-read-challenge", version: "1.0.0", requiredTests: ["read-trace", "read-result", "read-contract"] }),
  "foundations-explain-v1": Object.freeze({ exerciseId: "foundations-explain-challenge", version: "1.0.0", requiredTests: ["explain-except", "explain-edge"] }),
  "data-debug-v1": Object.freeze({ exerciseId: "data-debug-challenge", version: "1.0.0", requiredTests: ["concept-csv", "concept-decimal", "sample", "empty", "header", "invalid", "shape"] }),
  "data-scratch-v1": Object.freeze({ exerciseId: "data-scratch-challenge", version: "1.0.0", requiredTests: ["sample", "empty", "precision", "invalid", "shape"] }),
  "data-project-v1": Object.freeze({ exerciseId: "data-project-challenge", version: "1.0.0", requiredTests: ["concept-json", "sample", "empty", "envelope", "invalid", "duplicates", "shape"] }),
  "data-read-v1": Object.freeze({ exerciseId: "data-read-challenge", version: "1.0.0", requiredTests: ["read-value", "read-envelope"] }),
  "data-explain-v1": Object.freeze({ exerciseId: "data-explain-challenge", version: "1.0.0", requiredTests: ["explain-header", "explain-corruption"] }),
  "applied-debug-v1": Object.freeze({ exerciseId: "applied-debug-challenge", version: "1.0.0", requiredTests: ["concept-decimal", "sample", "empty", "invalid", "currency", "money", "shape"] }),
  "applied-scratch-v1": Object.freeze({ exerciseId: "applied-scratch-challenge", version: "1.0.0", requiredTests: ["boundary-199", "boundary-200", "boundary-299", "boundary-300", "retry-429", "retry-500", "client-404", "invalid"] }),
  "applied-project-v1": Object.freeze({ exerciseId: "applied-project-challenge", version: "1.0.0", requiredTests: ["concept-json", "sample", "empty", "invalid-json", "schema", "money", "shape"] }),
  "applied-read-v1": Object.freeze({ exerciseId: "applied-read-challenge", version: "1.0.0", requiredTests: ["read-exhaust", "read-client-error"] }),
  "applied-explain-v1": Object.freeze({ exerciseId: "applied-explain-challenge", version: "1.0.0", requiredTests: ["explain-fallback", "explain-retry"] }),
});
export function getGrader(exerciseId, graderId) {
  const grader = Object.hasOwn(graderCatalog, graderId) ? graderCatalog[graderId] : undefined;
  return grader?.exerciseId === exerciseId ? grader : undefined;
}
// Inspectable learning checks, not a security boundary against hostile Python.
export const paymentsSuite = String.raw`
import ast
import json
import traceback
from decimal import Decimal as GraderDecimal

def grade_submission(source):
    tests = []
    execution_ok = True
    def check(identifier, name, passed, detail=''):
        tests.append({'id': identifier, 'name': name, 'required': True, 'passed': bool(passed), 'detail': detail})
    try:
        tree = ast.parse(source)
        aliases = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for item in node.names:
                    aliases[item.asname or item.name] = item.name
            elif isinstance(node, ast.ImportFrom) and node.module in ('csv', 'decimal'):
                for item in node.names:
                    aliases[item.asname or item.name] = node.module + '.' + item.name
        def target(node):
            if isinstance(node, ast.Name):
                return aliases.get(node.id, node.id)
            if isinstance(node, ast.Attribute):
                return target(node.value) + '.' + node.attr
            return ''
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        def consumes_result(node):
            parent = parents.get(node)
            if isinstance(parent, ast.Expr):
                return False
            if isinstance(parent, (ast.Assign, ast.AnnAssign)):
                targets = parent.targets if isinstance(parent, ast.Assign) else [parent.target]
                names = {item.id for root in targets for item in ast.walk(root) if isinstance(item, ast.Name)}
                scope = parent
                while scope in parents and not isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    scope = parents[scope]
                return any(isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id in names for item in ast.walk(scope))
            return True
        concept_activity = set()
        decimal_values = []
        def track_call(concept, constructor):
            def tracked(*args, **kwargs):
                result = constructor(*args, **kwargs)
                if concept != 'concept-decimal' or (args and isinstance(args[0], str)):
                    concept_activity.add(concept)
                    if concept == 'concept-decimal' and isinstance(result, GraderDecimal) and result.is_finite():
                        decimal_values.append(result)
                return result
            return tracked
        class TrackConceptCalls(ast.NodeTransformer):
            def visit_Call(self, node):
                name = target(node.func)
                concept = None
                if name == 'csv.DictReader' and consumes_result(node):
                    concept = 'concept-csv'
                elif name == 'decimal.Decimal' and node.args and consumes_result(node):
                    # Constants (including a quantize unit) do not demonstrate parsing money.
                    if any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                        concept = 'concept-decimal'
                self.generic_visit(node)
                if concept:
                    node.func = ast.Call(func=ast.Name(id='__grade_track_call__', ctx=ast.Load()), args=[ast.Constant(concept), node.func], keywords=[])
                return node
        tree = ast.fix_missing_locations(TrackConceptCalls().visit(tree))
        check('concept-csv', 'Concept: call csv.DictReader on the executed data path', False)
        check('concept-decimal', 'Concept: call Decimal to parse the accepted payment amounts', False)
        namespace = {'__name__': '__submission__', '__grade_track_call__': track_call}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(csv_text).')
    except BaseException:
        return {'executionOk': False, 'tests': tests, 'error': traceback.format_exc()}
    fixtures = [
        ('sample', 'Normalize the visible payments sample',
         'id,amount,currency\n pay_101 ,12.00, usd \npay_102,,USD\npay_103,0.10,EUR\npay_101,90.00,USD\npay_104,-1.00,GBP\n',
         [{'id': 'pay_101', 'amount': '12.00', 'currency': 'USD'}, {'id': 'pay_103', 'amount': '0.10', 'currency': 'EUR'}]),
        ('empty', 'Empty CSV returns an empty list', '', []),
        ('header', 'Unexpected or reordered headers return an empty list',
         ['id,value,currency\na,2,USD\n', 'amount,id,currency\n2,a,USD\n', 'currency,amount,id\nUSD,2,a\n', 'id,currency,amount\na,USD,2\n'], []),
        ('precision', 'Exact cents, zero, and fractional-cent rejection',
         'id,amount,currency\na,0.10,USD\nb,0.20,EUR\nc,12.345,GBP\nd,0,USD\ne,-0.00,USD\nf,999999999999.99,EUR\ng,90071992547409.91,USD\nh,90071992547409.915,USD\ni,12345678901234567890123456.78,GBP\n',
         [{'id': 'a', 'amount': '0.10', 'currency': 'USD'}, {'id': 'b', 'amount': '0.20', 'currency': 'EUR'}, {'id': 'd', 'amount': '0.00', 'currency': 'USD'}, {'id': 'e', 'amount': '0.00', 'currency': 'USD'}, {'id': 'f', 'amount': '999999999999.99', 'currency': 'EUR'}, {'id': 'g', 'amount': '90071992547409.91', 'currency': 'USD'}, {'id': 'i', 'amount': '12345678901234567890123456.78', 'currency': 'GBP'}]),
        ('invalid', 'Reject missing, nonfinite, negative and invalid fields',
         'id,amount,currency\na,NaN,USD\nb,Infinity,USD\nc,-2,USD\nd,no,USD\ne,1,JPY\n,2,USD\nf,,USD\ng,2\nh,2,USD,extra\ni,1.5,gbp\n',
         [{'id': 'i', 'amount': '1.50', 'currency': 'GBP'}]),
        ('duplicates', 'Keep first valid occurrence of each trimmed ID',
         'id,amount,currency\nx,bad,USD\nx,2,USD\n x ,3,EUR\nX,5,EUR\n X ,6,USD\ny,4,GBP\nY,7,USD\n',
         [{'id': 'x', 'amount': '2.00', 'currency': 'USD'}, {'id': 'X', 'amount': '5.00', 'currency': 'EUR'}, {'id': 'y', 'amount': '4.00', 'currency': 'GBP'}, {'id': 'Y', 'amount': '7.00', 'currency': 'USD'}]),
        ('quoted', 'Parse quoted IDs and preserve input order',
         'id,amount,currency\n"pay,z",2.10,EUR\n"pay,a",3,USD\n',
         [{'id': 'pay,z', 'amount': '2.10', 'currency': 'EUR'}, {'id': 'pay,a', 'amount': '3.00', 'currency': 'USD'}]),
        ('shape', 'Header-only CSV returns an empty list', 'id,amount,currency\n', []),
    ]
    concept_activity.clear()
    decimal_covers_outputs = True
    checked_money_outputs = False
    for identifier, name, inputs, expected in fixtures:
        try:
            failures = []
            for csv_text in inputs if isinstance(inputs, list) else [inputs]:
                decimal_values.clear()
                actual = solve(csv_text)
                if expected:
                    checked_money_outputs = True
                    # Evidence belongs to this invocation's money outputs. An unrelated
                    # Decimal marker, even one used in a condition, cannot earn credit.
                    remaining = list(decimal_values)
                    for row in expected:
                        money = GraderDecimal(row['amount'])
                        if money in remaining:
                            remaining.remove(money)
                        else:
                            decimal_covers_outputs = False
                shape = type(actual) is list and all(type(row) is dict and set(row) == {'id', 'amount', 'currency'} and all(type(value) is str for value in row.values()) for row in actual)
                if not shape or actual != expected:
                    failures.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500])
            check(identifier, name, not failures, '\n'.join(failures))
        except BaseException:
            execution_ok = False
            check(identifier, name, False, traceback.format_exc())
    for concept in tests[:2]:
        concept['passed'] = concept['id'] in concept_activity
        if concept['id'] == 'concept-decimal':
            concept['passed'] = concept['passed'] and checked_money_outputs and decimal_covers_outputs
        if not concept['passed']:
            concept['detail'] = 'Call the required constructor on the executed data path and use its result. Each accepted payment amount must have a matching Decimal text conversion in that solve call; unrelated markers, unused calls, and constant-only calls do not count.'
    return {'executionOk': execution_ok, 'tests': tests, 'error': ''}

json.dumps(grade_submission(submission_source))
`;
