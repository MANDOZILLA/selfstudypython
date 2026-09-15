// Diagnostic coding graders. Inspectable educational checks, fail closed: any
// unexpected exception returns executionOk:false with the traceback.
// Style mirrors public/grading/mission-suites.js: String.raw templates ending
// with json.dumps(...), AST concept-call tracking reused from the mission harness.
const callFormsHarness = String.raw`
import ast
import json
import traceback

def grade(source, fixtures):
    checks = []
    activity = set()
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    def tracked(kind, constructor):
        def call(*args, **kwargs):
            # Concept credit is for reaching the call on the executed data path;
            # record before invoking so a call that raises on bad input still counts.
            activity.add(kind)
            return constructor(*args, **kwargs)
        return call
    # Fail closed with a COMPLETE check list: pre-register every required check
    # as failed before the submission is touched, so a submission that cannot be
    # parsed or loaded (syntax error, import error, wrong entry function) still
    # yields a well-formed graded result. Without this the check list would be
    # truncated and the protocol would misclassify the genuine failed attempt as
    # an infrastructure failure, silently discarding the evidence.
    check('concept-loads', False, 'The submission could not be loaded, so no calls were observed.')
    check('concept-map', False, 'The submission could not be loaded, so no calls were observed.')
    for fixture_id, _cases in fixtures:
        check(fixture_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        aliases = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for item in node.names:
                    aliases[item.asname or item.name] = item.name
            elif isinstance(node, ast.ImportFrom):
                for item in node.names:
                    aliases[item.asname or item.name] = (node.module or '') + '.' + item.name
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
        def loads_input(node):
            if node.args:
                return node.args[0]
            for keyword in node.keywords:
                if keyword.arg == 's':
                    return keyword.value
            return None
        def is_variable(value):
            return value is not None and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(value))
        def ceil_function(node):
            if node.args:
                func = node.args[0]
            else:
                func = next((keyword.value for keyword in node.keywords if keyword.arg == 'function'), None)
            return func is not None and target(func) == 'math.ceil'
        def has_iterable(node):
            return len(node.args) >= 2 or any(keyword.arg == 'iterable' for keyword in node.keywords)
        class TrackCalls(ast.NodeTransformer):
            def visit_Call(self, node):
                kind = None
                name = target(node.func)
                if name == 'json.loads' and consumes_result(node) and is_variable(loads_input(node)):
                    kind = 'concept-loads'
                elif name == 'map' and consumes_result(node) and ceil_function(node) and has_iterable(node):
                    kind = 'concept-map'
                self.generic_visit(node)
                if kind:
                    node.func = ast.Call(func=ast.Name(id='__grade_track__', ctx=ast.Load()), args=[ast.Constant(kind), node.func], keywords=[])
                return node
        tree = ast.fix_missing_locations(TrackCalls().visit(tree))
        namespace = {'__name__': '__submission__', '__grade_track__': tracked}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(payload).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                actual = solve(value)
                def exact(a, b):
                    if type(a) is not type(b):
                        return False
                    if type(b) is list:
                        return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
                    return a == b
                if not exact(actual, expected):
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    for concept in checks:
        if concept['id'] not in ('concept-loads', 'concept-map'):
            continue
        concept['passed'] = concept['id'] in activity
        if not concept['passed']:
            concept['detail'] = 'Call and use the required function on the executed data path. Bare, unused, assigned-but-never-read, or constant-only calls do not count.'
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}
`;

export const diagnosticCallFormsSuite = callFormsHarness + String.raw`
fixtures = [
    ('sample', [('[1.2, 2.7, -0.5]', [2, 3, 0])]),
    ('empty', [ ('[]', []) ]),
    ('invalid', [ ('not json', []), ('{"a": 1}', []) ]),
]
json.dumps(grade(submission_source, fixtures))
`;

export const diagnosticHttpSuite = String.raw`
import json
import traceback

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list: pre-register every required check
    # as failed before the submission is touched, so a submission that cannot be
    # parsed or loaded still yields a well-formed graded result instead of a
    # truncated one the protocol would misclassify as infrastructure noise.
    for boundary_id in ('boundary-199', 'boundary-200', 'boundary-299', 'boundary-300'):
        check(boundary_id, False, 'The submission could not be loaded.')
    try:
        namespace = {'__name__': '__submission__'}
        exec(compile(source, 'main.py', 'exec'), namespace)
        is_success = namespace.get('is_success')
        if not callable(is_success):
            raise ValueError('Define a callable is_success(status).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    for identifier, status, expected in [('boundary-199', 199, False), ('boundary-200', 200, True), ('boundary-299', 299, True), ('boundary-300', 300, False)]:
        try:
            actual = is_success(status)
            if type(actual) is not bool or actual != expected:
                check(identifier, False, 'is_success(' + repr(status) + ') returned ' + repr(actual) + '; expected ' + repr(expected) + '.')
            else:
                check(identifier, True)
        except BaseException:
            execution_ok = False
            check(identifier, False, traceback.format_exc())
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const diagnosticFilesSuite = String.raw`
import ast
import builtins
import json
import os
import tempfile
import traceback

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list: pre-register every required check
    # as failed before the submission is touched, so a submission that cannot be
    # parsed or loaded still yields a well-formed graded result instead of a
    # truncated one the protocol would misclassify as infrastructure noise.
    for file_id in ('reads-lines', 'context-manager', 'missing-file'):
        check(file_id, False, 'The submission could not be loaded.')
    real_open = builtins.open
    entered = []
    class TrackedFile:
        def __init__(self, wrapped):
            self._wrapped = wrapped
        def __enter__(self):
            entered.append(self)
            return self._wrapped.__enter__()
        def __exit__(self, *exc):
            return self._wrapped.__exit__(*exc)
        def __getattr__(self, name):
            return getattr(self._wrapped, name)
    def tracking_open(*args, **kwargs):
        return TrackedFile(real_open(*args, **kwargs))
    try:
        tree = ast.parse(source)
        with_open_found = False
        for node in ast.walk(tree):
            if isinstance(node, ast.With):
                for item in node.items:
                    context = item.context_expr
                    func = context.func if isinstance(context, ast.Call) else None
                    name = ''
                    if isinstance(func, ast.Name):
                        name = func.id
                    elif isinstance(func, ast.Attribute):
                        name = func.attr
                    if name == 'open':
                        with_open_found = True
        namespace = {'__name__': '__submission__', 'open': tracking_open}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        read_lines = namespace.get('read_lines')
        if not callable(read_lines):
            raise ValueError('Define a callable read_lines(path).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    builtins.open = tracking_open
    try:
        with tempfile.TemporaryDirectory() as tmp:
            sample_path = os.path.join(tmp, 'sample.txt')
            with real_open(sample_path, 'w') as handle:
                handle.write('a\nb\n')
            plain_path = os.path.join(tmp, 'plain.txt')
            with real_open(plain_path, 'w') as handle:
                handle.write('a\nb')
            def exact(a, b):
                if type(a) is not type(b):
                    return False
                if type(b) is list:
                    return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
                return a == b
            entered.clear()
            errors = []
            for path, expected in [(sample_path, ['a', 'b']), (plain_path, ['a', 'b'])]:
                try:
                    actual = read_lines(path)
                    if not exact(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check('reads-lines', not errors, '\n'.join(errors))
            if with_open_found and entered:
                check('context-manager', True)
            else:
                reasons = []
                if not with_open_found:
                    reasons.append('No with-statement wrapping an open(...) call was found.')
                if not entered:
                    reasons.append('No file opened during the graded calls was entered as a context manager; open the file with "with open(...) as ...".')
                check('context-manager', False, ' '.join(reasons))
            missing = os.path.join(tmp, 'missing.txt')
            try:
                result = read_lines(missing)
                check('missing-file', False, 'Expected FileNotFoundError for a missing path; returned ' + repr(result)[:200] + ' instead.')
            except FileNotFoundError:
                check('missing-file', True)
            except BaseException:
                execution_ok = False
                check('missing-file', False, traceback.format_exc())
    finally:
        builtins.open = real_open
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
