// Second mission-suite collection: graders for the expanded ten-mission curriculum.
// Style mirrors mission-suites.js and diagnostic-suites.js: String.raw Python
// templates ending with json.dumps(...), fail-closed with complete pre-registered
// check lists. Inspectable educational checks, not a hostile-code security boundary.
import { harness } from "./mission-suites.js";

export const stackTraceSuite = harness + String.raw`
fixtures = [
 ('sample', [(
'''Traceback (most recent call last):
  File "app.py", line 10, in <module>
    main()
  File "app.py", line 4, in main
    total = int(value)
ValueError: invalid literal for int() with base 10: 'abc'
''',
 {'type': 'ValueError', 'message': "invalid literal for int() with base 10: 'abc'",
  'frames': [{'file': 'app.py', 'line': 10, 'function': '<module>'}, {'file': 'app.py', 'line': 4, 'function': 'main'}]} )]),
 ('empty', [('', {'type': '', 'message': '', 'frames': []}), ('   \n', {'type': '', 'message': '', 'frames': []})]),
 ('invalid', [(None, {'type': '', 'message': '', 'frames': []}), (123, {'type': '', 'message': '', 'frames': []}),
              ('just some log text\nno traceback here', {'type': '', 'message': '', 'frames': []})]),
 ('chained', [(
'''Traceback (most recent call last):
  File "a.py", line 1, in <module>
    open("missing.txt")
FileNotFoundError: [Errno 2] No such file or directory: 'missing.txt'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "b.py", line 5, in <module>
    handle()
  File "b.py", line 2, in handle
    raise RuntimeError("boom")
RuntimeError: boom
''',
 {'type': 'RuntimeError', 'message': 'boom',
  'frames': [{'file': 'b.py', 'line': 5, 'function': '<module>'}, {'file': 'b.py', 'line': 2, 'function': 'handle'}]} )]),
 ('syntax', [(
'''  File "broken.py", line 3
    def broken(
               ^
SyntaxError: expected ':'
''',
 {'type': 'SyntaxError', 'message': "expected ':'", 'frames': [{'file': 'broken.py', 'line': 3, 'function': ''}]} )]),
]
json.dumps(grade(submission_source, fixtures))
`;

export const logScanSuite = String.raw`
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
    # as failed before the submission is touched.
    for scan_id in ('concept-open', 'concept-with', 'sample', 'empty', 'invalid', 'shape'):
        check(scan_id, False, 'The submission could not be loaded.')
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
        with_open_found = False
        open_called = False
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
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else (func.attr if isinstance(func, ast.Attribute) else '')
                if name == 'open' and consumes_result(node) and node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                    open_called = True
        namespace = {'__name__': '__submission__', 'open': tracking_open}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(path).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-open', open_called, '' if open_called else 'Call open(path) with the input path on the executed data path and use the result. Unused or constant-only calls do not count.')
    execution_ok = True
    sample_text = 'INFO starting import\nWARN missing column, using default\nERROR row 3: bad amount\nINFO 2 rows imported\nERROR row 9: duplicate id\ngarbage line without level\nWARN retrying\n'
    sample_expected = {'error': 2, 'warning': 2, 'info': 2}
    builtins.open = tracking_open
    try:
        with tempfile.TemporaryDirectory() as tmp:
            sample_path = os.path.join(tmp, 'sample.log')
            with real_open(sample_path, 'w') as handle:
                handle.write(sample_text)
            empty_path = os.path.join(tmp, 'empty.log')
            with real_open(empty_path, 'w') as handle:
                handle.write('')
            def exact(a, b):
                return type(a) is type(b) is dict and a.keys() == b.keys() and all(type(a[k]) is int and a[k] == b[k] for k in b)
            entered.clear()
            try:
                actual = solve(sample_path)
                check('sample', exact(actual, sample_expected), '' if exact(actual, sample_expected) else 'Expected ' + repr(sample_expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                check('sample', False, traceback.format_exc())
            if with_open_found and entered:
                check('concept-with', True)
            else:
                reasons = []
                if not with_open_found:
                    reasons.append('No with-statement wrapping an open(...) call was found.')
                if not entered:
                    reasons.append('No file opened during the graded calls was entered as a context manager.')
                check('concept-with', False, ' '.join(reasons))
            try:
                actual = solve(empty_path)
                zeros = {'error': 0, 'warning': 0, 'info': 0}
                check('empty', exact(actual, zeros), '' if exact(actual, zeros) else 'Expected ' + repr(zeros) + '; received ' + repr(actual)[:200])
            except BaseException:
                execution_ok = False
                check('empty', False, traceback.format_exc())
            invalid_errors = []
            for value in (os.path.join(tmp, 'missing.log'), None, 123):
                try:
                    actual = solve(value)
                    zeros = {'error': 0, 'warning': 0, 'info': 0}
                    if not exact(actual, zeros):
                        invalid_errors.append('solve(' + repr(value)[:60] + ') returned ' + repr(actual)[:200] + '; expected ' + repr(zeros))
                except BaseException:
                    execution_ok = False
                    invalid_errors.append(traceback.format_exc())
            check('invalid', not invalid_errors, '\n'.join(invalid_errors))
            try:
                actual = solve(sample_path)
                shape_ok = type(actual) is dict and set(actual) == {'error', 'warning', 'info'} and all(type(actual[k]) is int for k in actual)
                check('shape', shape_ok, '' if shape_ok else 'Return a dict with exactly integer error, warning and info counts; received ' + repr(actual)[:200])
            except BaseException:
                execution_ok = False
                check('shape', False, traceback.format_exc())
    finally:
        builtins.open = real_open
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const validatorsSuite = String.raw`
import ast
import copy
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
    # as failed before the submission is touched.
    for validator_id in ('concept-reuse', 'sample', 'empty', 'invalid', 'shape'):
        check(validator_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        defined = {node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        solve_node = next((node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == 'solve'), None)
        reuse = False
        if solve_node is not None:
            for node in ast.walk(solve_node):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in defined and node.func.id != 'solve':
                    reuse = True
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(users).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-reuse', reuse, '' if reuse else 'Define at least one helper function and call it from solve. Inlining every check inside solve does not demonstrate reusable validation.')
    fixtures = [
        ('sample', [(
            [{"username": " amy ", "age": 30}, {"username": "bo", "age": 25}, {"username": "cy_99", "age": 12},
             {"username": "dee", "age": True}, {"username": None, "age": 40}, "x", None,
             {"username": "eli_7", "age": 45}, {"username": "abc", "age": 13},
             {"username": "xxxxxxxxxxxxxxxxxxxx", "age": 120}, {"username": "y" * 21, "age": 20}],
            ["amy", "eli_7", "abc", "xxxxxxxxxxxxxxxxxxxx"])]),
        ('empty', [([], []), (None, []), ("text", [])]),
        ('invalid', [(
            [{"username": "ab", "age": 20}, {"username": "ok_user", "age": 10},
             {"username": "dash-name", "age": 20}, {"username": "has space", "age": 20},
             {"username": "good", "age": 121}, {"username": "good2", "age": 12.0}], [])]),
        ('shape', [([{"username": " zed ", "age": 99, "extra": 1}], ["zed"])]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                if type(actual) is not list or any(type(item) is not str for item in actual):
                    errors.append('Expected a list of strings; received ' + repr(actual)[:400])
                elif actual != expected or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const transformSuite = String.raw`
import ast
import copy
import json
import traceback
from decimal import Decimal as GraderDecimal

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
    # as failed before the submission is touched.
    for transform_id in ('concept-comprehension', 'sample', 'empty', 'invalid', 'precision', 'shape'):
        check(transform_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        comprehension = any(isinstance(node, (ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)) for node in ast.walk(tree))
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(orders).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-comprehension', comprehension, '' if comprehension else 'Use at least one comprehension (list, dict, set, or generator) in your transformation.')
    fixtures = [
        ('sample', [(
            [{"customer": "amy", "items": [{"sku": "a", "qty": 2, "price": "3.50"}, {"sku": "b", "qty": 1, "price": "0.10"}]},
             {"customer": "ben", "items": [{"sku": "c", "qty": 3, "price": "2.00"}]},
             {"customer": "amy", "items": [{"sku": "d", "qty": 1, "price": "1.25"}]}],
            [{"customer": "amy", "orders": 2, "items": 4, "total": "8.35"},
             {"customer": "ben", "orders": 1, "items": 3, "total": "6.00"}])]),
        ('empty', [([], []), (None, []), ("text", [])]),
        ('invalid', [(
            [None, "x", {"customer": "amy"}, {"customer": "amy", "items": "nope"},
             {"customer": "amy", "items": [{"sku": "a", "qty": True, "price": "1.00"}]},
             {"customer": "amy", "items": [{"sku": "a", "qty": 1, "price": "bad"}]},
             {"customer": " ", "items": []}], [])]),
        ('precision', [(
            [{"customer": "z", "items": [{"sku": "a", "qty": 1, "price": "2.675"}, {"sku": "b", "qty": 2, "price": "0.10"}]}],
            [{"customer": "z", "orders": 1, "items": 3, "total": "2.88"}])]),
        ('shape', [(
            [{"customer": " b ", "items": [{"sku": "a", "qty": 1, "price": "1.00", "extra": 9}]}],
            [{"customer": "b", "orders": 1, "items": 1, "total": "1.00"}])]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                def exact(a, b):
                    if type(a) is not type(b):
                        return False
                    if type(b) is list:
                        return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
                    if type(b) is dict:
                        return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
                    return a == b
                if not exact(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

const pandasHarness = String.raw`
import ast
import copy
import io
import json
import traceback
import numpy as np
import pandas as pd

def grade(source, fixtures, entry):
    checks = []
    def check(identifier, passed, detail=''):
        entry_check = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry_check
                return
        checks.append(entry_check)
    # Fail closed with a COMPLETE check list: pre-register every required check
    # as failed before the submission is touched.
    check('concept-pandas', False, 'The submission could not be loaded.')
    for fixture_id, _cases in fixtures:
        check(fixture_id, False, 'The submission could not be loaded.')
    activity = set()
    def tracked(kind, constructor):
        def call(*args, **kwargs):
            activity.add(kind)
            return constructor(*args, **kwargs)
        return call
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
        class TrackPandas(ast.NodeTransformer):
            def visit_Call(self, node):
                kind = None
                if target(node.func) == 'pandas.read_csv' and consumes_result(node) and node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                    kind = 'concept-pandas'
                self.generic_visit(node)
                if kind:
                    node.func = ast.Call(func=ast.Name(id='__grade_track__', ctx=ast.Load()), args=[ast.Constant(kind), node.func], keywords=[])
                return node
        tree = ast.fix_missing_locations(TrackPandas().visit(tree))
        namespace = {'__name__': '__submission__', '__grade_track__': tracked}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(csv_text).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    def approx(a, b):
        if isinstance(b, float):
            return isinstance(a, (int, float, np.integer, np.floating)) and not isinstance(a, bool) and abs(float(a) - b) < 1e-9
        if isinstance(b, int):
            return isinstance(a, (int, np.integer)) and not isinstance(a, bool) and int(a) == b
        if isinstance(b, str):
            return type(a) is str and a == b
        if isinstance(b, list):
            return isinstance(a, list) and len(a) == len(b) and all(approx(x, y) for x, y in zip(a, b))
        if isinstance(b, dict):
            return isinstance(a, dict) and set(a.keys()) == set(b.keys()) and all(approx(a[k], b[k]) for k in b)
        return False
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                if not approx(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    # The concept check runs AFTER the fixtures: activity is only populated
    # when solve() actually executes the tracked pandas.read_csv call.
    check('concept-pandas', 'concept-pandas' in activity,
          '' if 'concept-pandas' in activity else 'Call pandas.read_csv on the executed data path and use the result. Unused or constant-only calls do not count.')
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}
`;

export const pandasCleanSuite = pandasHarness + String.raw`
fixtures = [
 ('sample', [(
  'id,region,amount,qty\na1,north,10.50,2\na2,south,,1\na3,north,7.50,\na4,,12.00,3\n,west,5.00,1\na5,east,abc,2\n',
  [{'id': 'a1', 'region': 'north', 'amount': 10.50, 'qty': 2},
   {'id': 'a2', 'region': 'south', 'amount': 10.50, 'qty': 1},
   {'id': 'a3', 'region': 'north', 'amount': 7.50, 'qty': 0},
   {'id': 'a4', 'region': 'unknown', 'amount': 12.00, 'qty': 3},
   {'id': 'a5', 'region': 'east', 'amount': 10.50, 'qty': 2}])]),
 ('empty', [('', []), ('id,region,amount,qty\n', [])]),
 ('invalid', [(None, []), (123, [])]),
 ('missing', [(
  'id,region,amount,qty\nb1,north,,2\nb2,south,,1\n',
  [{'id': 'b1', 'region': 'north', 'amount': 0.0, 'qty': 2},
   {'id': 'b2', 'region': 'south', 'amount': 0.0, 'qty': 1}])]),
 ('shape', [(
  'id,region,amount,qty\na1,north,10.50,2\n',
  [{'id': 'a1', 'region': 'north', 'amount': 10.50, 'qty': 2}])]),
]
json.dumps(grade(submission_source, fixtures, 'solve'))
`;

export const pandasProjectSuite = pandasHarness + String.raw`
def zero_report():
    return {"rows_in": 0, "rows_out": 0, "dropped": 0,
            "fill_report": {"amount": "median", "region": "unknown"}, "by_region": []}
fixtures = [
 ('sample', [(
  'id,region,amount\no1,north,10.00\no2,south,20.00\no3,north,30.00\no4,,40.00\no5,east,\n,bad,5.00\no6,south,xyz\n',
  {"rows_in": 7, "rows_out": 6, "dropped": 1,
   "fill_report": {"amount": "median", "region": "unknown"},
   "by_region": [{"region": "south", "orders": 2, "total": 45.00},
                 {"region": "north", "orders": 2, "total": 40.00},
                 {"region": "unknown", "orders": 1, "total": 40.00},
                 {"region": "east", "orders": 1, "total": 25.00}]})]),
 ('empty', [('', zero_report()), ('id,region,amount\n', zero_report())]),
 ('invalid', [(None, zero_report()), (123, zero_report())]),
 ('missing', [(
  'id,region,amount\nm1,west,\nm2,west,\n',
  {"rows_in": 2, "rows_out": 2, "dropped": 0,
   "fill_report": {"amount": "median", "region": "unknown"},
   "by_region": [{"region": "west", "orders": 2, "total": 0.0}]})]),
 ('shape', [(
  'id,region,amount\no1,north,10.00\n',
  {"rows_in": 1, "rows_out": 1, "dropped": 0,
   "fill_report": {"amount": "median", "region": "unknown"},
   "by_region": [{"region": "north", "orders": 1, "total": 10.00}]})]),
]
json.dumps(grade(submission_source, fixtures, 'solve'))
`;

const sqliteBase = String.raw`
import ast
import copy
import json
import os
import sqlite3
import tempfile
import traceback

def build_transformers(activity):
    def tracked(kind, constructor):
        def call(*args, **kwargs):
            activity.add(kind)
            return constructor(*args, **kwargs)
        return call
    def tracked_execute(kind, method):
        def call(*args, **kwargs):
            sql = args[0] if args else ''
            if isinstance(sql, str) and any(word in sql.upper() for word in ('INSERT', 'UPDATE', 'DELETE')):
                activity.add(kind)
            return method(*args, **kwargs)
        return call
    return tracked, tracked_execute

def parse_aliases(tree):
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
    return target

def build_parents(tree):
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
    return consumes_result

def has_with_connect(tree, target):
    return any(
        isinstance(item.context_expr, ast.Call) and target(item.context_expr.func) == 'sqlite3.connect'
        for node in ast.walk(tree) if isinstance(node, ast.With)
        for item in node.items)

def approx(a, b):
    if isinstance(b, float):
        return isinstance(a, (int, float)) and not isinstance(a, bool) and abs(float(a) - b) < 1e-9
    if isinstance(b, int):
        return type(a) is int and a == b
    if isinstance(b, str):
        return type(a) is str and a == b
    if isinstance(b, list):
        return isinstance(a, list) and len(a) == len(b) and all(approx(x, y) for x, y in zip(a, b))
    if isinstance(b, dict):
        return isinstance(a, dict) and set(a.keys()) == set(b.keys()) and all(approx(a[k], b[k]) for k in b)
    if b is None:
        return a is None
    return False
`;

export const sqliteAggSuite = sqliteBase + String.raw`
SETUP_SQL = """
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, region TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL);
"""
SAMPLE_CUSTOMERS = [(1, 'amy', 'north'), (2, 'ben', 'south'), (3, 'cat', 'north'), (4, 'dan', None)]
SAMPLE_ORDERS = [(1, 1, 10.00), (2, 1, 20.00), (3, 2, 50.00), (4, 3, 5.00), (5, 99, 100.00), (6, 4, 7.00)]

def make_db(customers, orders, schema=True):
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    if schema:
        conn = sqlite3.connect(path)
        try:
            conn.executescript(SETUP_SQL)
            conn.executemany("INSERT INTO customers (id, name, region) VALUES (?, ?, ?)", customers)
            conn.executemany("INSERT INTO orders (id, customer_id, amount) VALUES (?, ?, ?)", orders)
            conn.commit()
        finally:
            conn.close()
    return path

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list before the submission is touched.
    for pre_id in ('concept-sqlite', 'sample', 'empty', 'missing', 'shape'):
        check(pre_id, False, 'The submission could not be loaded.')
    activity = set()
    tracked, _tracked_execute = build_transformers(activity)
    temp_paths = []
    def fresh_db(customers=(), orders=(), schema=True):
        path = make_db(customers, orders, schema)
        temp_paths.append(path)
        return path
    missing_path = os.path.join(tempfile.gettempdir(), 'no-such-sqlite-db-xyz.db')
    temp_paths.append(missing_path)
    try:
        tree = ast.parse(source)
        target = parse_aliases(tree)
        with_connect = has_with_connect(tree, target)
        consumes_result = build_parents(tree)
        class TrackSqlite(ast.NodeTransformer):
            def visit_Call(self, node):
                kind = None
                if target(node.func) == 'sqlite3.connect' and consumes_result(node) and node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                    kind = 'concept-sqlite'
                self.generic_visit(node)
                if kind:
                    node.func = ast.Call(func=ast.Name(id='__grade_track__', ctx=ast.Load()), args=[ast.Constant(kind), node.func], keywords=[])
                return node
        tree = ast.fix_missing_locations(TrackSqlite().visit(tree))
        namespace = {'__name__': '__submission__', '__grade_track__': tracked}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(db_path).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    fixtures = [
        ('sample', [(fresh_db(SAMPLE_CUSTOMERS, SAMPLE_ORDERS),
                     [{'region': 'south', 'orders': 1, 'total': 50.00},
                      {'region': 'north', 'orders': 3, 'total': 35.00},
                      {'region': 'unknown', 'orders': 1, 'total': 7.00}])]),
        ('empty', [(fresh_db(), [])]),
        ('missing', [(missing_path, []), (fresh_db(schema=False), [])]),
        ('shape', [(fresh_db([(1, 'amy', 'east')], [(1, 1, 9.99)]),
                    [{'region': 'east', 'orders': 1, 'total': 9.99}])]),
    ]
    execution_ok = True
    try:
        for identifier, cases in fixtures:
            errors = []
            for value, expected in cases:
                try:
                    actual = solve(value)
                    if not approx(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except OSError:
                pass
    # The concept check runs AFTER the fixtures: activity is only populated
    # when solve() actually executes the tracked sqlite3.connect call.
    concept_ok = with_connect and 'concept-sqlite' in activity
    check('concept-sqlite', concept_ok,
          '' if concept_ok else 'Open the database with a context manager on the executed path: with sqlite3.connect(db_path) as conn: ... Unused or constant-only calls do not count.')
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const sqliteProjectSuite = sqliteBase + String.raw`
SETUP_SQL = """
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, region TEXT);
CREATE TABLE ledger (id INTEGER PRIMARY KEY, customer_id INTEGER, amount_cents INTEGER, note TEXT);
"""
SAMPLE_CUSTOMERS = [(1, 'amy', 'north'), (2, 'ben', 'south')]
SAMPLE_ENTRIES = [
    {"customer_id": 1, "amount": "10.00", "note": "a"},
    {"customer_id": 2, "amount": "5.50"},
    {"customer_id": 99, "amount": "3.00"},
    {"customer_id": 1, "amount": "bad"},
    {"customer_id": 1, "amount": "-2.00"},
    "junk",
    None,
    {"customer_id": 1},
]
SAMPLE_REPORT = {"inserted": 2, "rejected": 6, "total": "15.50"}

def make_db(customers):
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    conn = sqlite3.connect(path)
    try:
        conn.executescript(SETUP_SQL)
        conn.executemany("INSERT INTO customers (id, name, region) VALUES (?, ?, ?)", customers)
        conn.commit()
    finally:
        conn.close()
    return path

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list before the submission is touched.
    for pre_id in ('concept-sqlite', 'concept-transaction', 'sample', 'empty', 'committed', 'shape'):
        check(pre_id, False, 'The submission could not be loaded.')
    activity = set()
    tracked, tracked_execute = build_transformers(activity)
    temp_paths = []
    def fresh_db(customers=()):
        path = make_db(customers)
        temp_paths.append(path)
        return path
    try:
        tree = ast.parse(source)
        target = parse_aliases(tree)
        with_connect = has_with_connect(tree, target)
        consumes_result = build_parents(tree)
        class TrackSqlite(ast.NodeTransformer):
            def visit_Call(self, node):
                kind = None
                execute_kind = None
                func = node.func
                if isinstance(func, ast.Attribute) and func.attr in ('execute', 'executemany'):
                    execute_kind = 'concept-transaction'
                elif target(func) == 'sqlite3.connect' and consumes_result(node) and node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                    kind = 'concept-sqlite'
                self.generic_visit(node)
                if kind:
                    node.func = ast.Call(func=ast.Name(id='__grade_track__', ctx=ast.Load()), args=[ast.Constant(kind), node.func], keywords=[])
                elif execute_kind:
                    node.func = ast.Call(func=ast.Name(id='__grade_track_execute__', ctx=ast.Load()), args=[ast.Constant(execute_kind), node.func], keywords=[])
                return node
        tree = ast.fix_missing_locations(TrackSqlite().visit(tree))
        namespace = {'__name__': '__submission__', '__grade_track__': tracked, '__grade_track_execute__': tracked_execute}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(db_path, entries).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    fixtures = [
        ('sample', [(fresh_db(SAMPLE_CUSTOMERS), copy.deepcopy(SAMPLE_ENTRIES), SAMPLE_REPORT)]),
        ('empty', [(fresh_db(SAMPLE_CUSTOMERS), [], {"inserted": 0, "rejected": 0, "total": "0.00"})]),
        ('shape', [(fresh_db(SAMPLE_CUSTOMERS), [{"customer_id": 1, "amount": "9.99"}],
                    {"inserted": 1, "rejected": 0, "total": "9.99"})]),
    ]
    committed_db = fresh_db(SAMPLE_CUSTOMERS)
    execution_ok = True
    try:
        for identifier, cases in fixtures:
            errors = []
            for db_path, entries, expected in cases:
                try:
                    actual = solve(db_path, copy.deepcopy(entries))
                    if not approx(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
        # Committed: a FRESH connection must see the posted rows, proving the
        # transaction was committed (with-block exit or explicit commit).
        committed_errors = []
        try:
            solve(committed_db, copy.deepcopy(SAMPLE_ENTRIES))
            verify = sqlite3.connect(committed_db)
            try:
                rows = verify.execute("SELECT customer_id, amount_cents FROM ledger ORDER BY id").fetchall()
            finally:
                verify.close()
            if rows != [(1, 1000), (2, 550)]:
                committed_errors.append('Expected ledger rows [(1, 1000), (2, 550)]; found ' + repr(rows)[:300])
        except BaseException:
            execution_ok = False
            committed_errors.append(traceback.format_exc())
        check('committed', not committed_errors, '\n'.join(committed_errors))
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except OSError:
                pass
    # Concept checks run AFTER the fixtures: activity is only populated when
    # solve() actually executes the tracked calls.
    sqlite_ok = with_connect and 'concept-sqlite' in activity
    check('concept-sqlite', sqlite_ok,
          '' if sqlite_ok else 'Open the database with a context manager on the executed path: with sqlite3.connect(db_path) as conn: ...')
    transaction_ok = 'concept-transaction' in activity
    check('concept-transaction', transaction_ok,
          '' if transaction_ok else 'Execute a write (INSERT/UPDATE/DELETE) through the connection inside the transaction.')
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const moneyReconSuite = String.raw`
import ast
import copy
import json
import traceback
from decimal import Decimal as GraderDecimal

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list before the submission is touched.
    for recon_id in ('sample', 'empty', 'invalid', 'anomaly', 'shape'):
        check(recon_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(transactions).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return set(a.keys()) == set(b.keys()) and all(exact(a[k], b[k]) for k in b)
        return a == b
    def zero_report():
        return {"balanced": True, "total": "0.00", "anomalies": []}
    fixtures = [
        ('sample', [(
            [{"id": "t1", "amount": "10.10", "type": "credit"},
             {"id": "t2", "amount": "0.10", "type": "debit"},
             {"id": "t3", "amount": "10.00", "type": "debit"},
             {"id": "t4", "amount": "bad", "type": "credit"},
             {"id": "t5", "amount": "1.00", "type": "weird"},
             {"id": "t1", "amount": "1.00", "type": "credit"}],
            {"balanced": True, "total": "0.00", "anomalies": ["t4", "t5", "t1"]})]),
        ('empty', [([], zero_report())]),
        ('invalid', [(None, zero_report()), ("text", zero_report()), (123, zero_report())]),
        ('anomaly', [(
            [{"id": "a", "amount": "NaN", "type": "credit"},
             {"id": "b", "amount": "1.005", "type": "debit"},
             {"id": "c", "amount": "0", "type": "credit"},
             {"id": "d", "amount": "2.50", "type": "debit"}],
            {"balanced": False, "total": "-2.50", "anomalies": ["a", "b", "c"]})]),
        ('shape', [(
            [{"id": "x", "amount": "3.25", "type": "credit", "extra": 1}],
            {"balanced": False, "total": "3.25", "anomalies": []})]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                if not exact(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const moneyProjectSuite = pandasHarness + String.raw`
fixtures = [
 ('sample', [(
  'id,amount,type\nt1,10.10,credit\nt2,0.10,debit\nt3,10.00,debit\nt4,bad,credit\nt5,1.00,weird\nt1,2.00,credit\n',
  {"rows": 6, "flagged": ["t4", "t5", "t1"], "net": "0.00"})]),
 ('empty', [('', {"rows": 0, "flagged": [], "net": "0.00"}), ('id,amount,type\n', {"rows": 0, "flagged": [], "net": "0.00"})]),
 ('invalid', [(None, {"rows": 0, "flagged": [], "net": "0.00"}), (123, {"rows": 0, "flagged": [], "net": "0.00"})]),
 ('anomaly', [(
  'id,amount,type\na,NaN,credit\nb,1.005,debit\nc,0,credit\nd,2.50,debit\n',
  {"rows": 4, "flagged": ["a", "b", "c"], "net": "-2.50"})]),
 ('shape', [(
  'id,amount,type\nx,3.25,credit\n',
  {"rows": 1, "flagged": [], "net": "3.25"})]),
]
json.dumps(grade(submission_source, fixtures, 'solve'))
`;

export const httpClientSuite = String.raw`
import ast
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
    # Fail closed with a COMPLETE check list before the submission is touched.
    for client_id in ('boundary-199', 'boundary-200', 'boundary-299', 'boundary-300', 'retry-after', 'retries', 'no-retry-client-error', 'exhausted'):
        check(client_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(transport, url, sleep).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}

    class FakeTransport:
        # Deterministic scripted transport. No real network is ever used.
        def __init__(self, script):
            self.script = list(script)
            self.calls = []
        def __call__(self, method, url):
            self.calls.append((method, url))
            if len(self.calls) > 50:
                raise RuntimeError('transport call budget exceeded')
            if self.script:
                return self.script.pop(0)
            return (500, {}, '')

    class SleepRecorder:
        def __init__(self):
            self.calls = []
        def __call__(self, seconds):
            self.calls.append(float(seconds))

    cases = [
        ('boundary-199', [(199, {}, 'weird')],
         {"ok": False, "status": 199, "body": 'weird', "attempts": 1}, []),
        ('boundary-200', [(200, {}, 'hello')],
         {"ok": True, "status": 200, "body": 'hello', "attempts": 1}, []),
        ('boundary-299', [(299, {}, 'edge')],
         {"ok": True, "status": 299, "body": 'edge', "attempts": 1}, []),
        ('boundary-300', [(300, {}, 'moved')],
         {"ok": False, "status": 300, "body": 'moved', "attempts": 1}, []),
        ('retry-after', [(429, {'Retry-After': '120'}, ''), (200, {}, 'recovered')],
         {"ok": True, "status": 200, "body": 'recovered', "attempts": 2}, [60.0]),
        ('retries', [(500, {}, ''), (503, {}, ''), (200, {}, 'late')],
         {"ok": True, "status": 200, "body": 'late', "attempts": 3}, [1.0, 2.0]),
        ('no-retry-client-error', [(400, {}, 'bad'), (200, {}, 'late')],
         {"ok": False, "status": 400, "body": 'bad', "attempts": 1}, []),
        ('exhausted', [(500, {}, ''), (500, {}, ''), (500, {}, ''), (200, {}, 'too-late')],
         {"ok": False, "status": 500, "body": '', "attempts": 3}, [1.0, 2.0]),
    ]
    execution_ok = True
    for identifier, script, expected, expected_sleeps in cases:
        errors = []
        try:
            transport = FakeTransport(script)
            sleep = SleepRecorder()
            result = solve(transport, '/resource', sleep)
            if type(result) is not dict or set(result.keys()) != {'ok', 'status', 'body', 'attempts'}:
                errors.append('Expected a dict with keys ok/status/body/attempts; received ' + repr(result)[:300])
            elif result != expected:
                errors.append('Expected ' + repr(expected) + '; received ' + repr(result)[:300])
            if list(sleep.calls) != expected_sleeps:
                errors.append('Expected sleep calls ' + repr(expected_sleeps) + '; observed ' + repr(sleep.calls)[:200])
            if len(transport.calls) != expected['attempts']:
                errors.append('Expected %d transport call(s); observed %d' % (expected['attempts'], len(transport.calls)))
        except BaseException:
            execution_ok = False
            errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const httpProjectSuite = String.raw`
import ast
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
    # Fail closed with a COMPLETE check list before the submission is touched.
    for project_id in ('pagination', 'retries', 'page-limit', 'unrecoverable', 'shape'):
        check(project_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(transport, base_url, sleep).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}

    class FakeTransport:
        # Deterministic allowlisted transport. Only configured paths respond;
        # anything else (including absolute third-party URLs) is rejected.
        # No real network is ever used.
        def __init__(self, routes):
            self.routes = {path: list(script) for path, script in routes.items()}
            self.calls = []
        def __call__(self, method, url):
            self.calls.append((method, url))
            if len(self.calls) > 200:
                raise RuntimeError('transport call budget exceeded')
            script = self.routes.get(url)
            if not script:
                return (400, {}, 'not allowlisted')
            return script.pop(0)

    class SleepRecorder:
        def __init__(self):
            self.calls = []
        def __call__(self, seconds):
            self.calls.append(float(seconds))

    def page(items, nxt):
        return (200, {}, json.dumps({"items": items, "next": nxt}))

    long_routes = {}
    for number in range(1, 13):
        nxt = '/p%d' % (number + 1) if number < 12 else None
        long_routes['/p%d' % number] = [page(['item%d' % number], nxt)]

    cases = [
        ('pagination',
         {'/page1': [page(['a', 'b'], '/page2')],
          '/page2': [page(['c'], 'https://api.example.com/page3')]},
         '/page1',
         {"items": ['a', 'b', 'c'], "pages": 2, "ok": True}, []),
        ('retries',
         {'/page1': [page(['a'], '/page2')],
          '/page2': [(500, {}, ''), page(['b'], None)]},
         '/page1',
         {"items": ['a', 'b'], "pages": 2, "ok": True}, [1.0]),
        ('page-limit', long_routes, '/p1',
         {"items": ['item%d' % n for n in range(1, 11)], "pages": 10, "ok": True}, []),
        ('unrecoverable',
         {'/page1': [page(['a'], '/page2')],
          '/page2': [(404, {}, 'gone')]},
         '/page1',
         {"items": ['a'], "pages": 1, "ok": False}, []),
        ('shape',
         {'/only': [page([1, 2], None)]},
         '/only',
         {"items": [1, 2], "pages": 1, "ok": True}, []),
    ]
    execution_ok = True
    for identifier, routes, base_url, expected, expected_sleeps in cases:
        errors = []
        try:
            transport = FakeTransport(routes)
            sleep = SleepRecorder()
            result = solve(transport, base_url, sleep)
            if type(result) is not dict or set(result.keys()) != {'items', 'pages', 'ok'}:
                errors.append('Expected a dict with keys items/pages/ok; received ' + repr(result)[:300])
            elif type(result['items']) is not list or type(result['pages']) is not int or type(result['ok']) is not bool:
                errors.append('Expected items as list, pages as int, ok as bool; received ' + repr(result)[:300])
            elif result != expected:
                errors.append('Expected ' + repr(expected) + '; received ' + repr(result)[:400])
            if list(sleep.calls) != expected_sleeps:
                errors.append('Expected sleep calls ' + repr(expected_sleeps) + '; observed ' + repr(sleep.calls)[:200])
        except BaseException:
            execution_ok = False
            errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const llmGuardSuite = String.raw`
import ast
import copy
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
    # Fail closed with a COMPLETE check list before the submission is touched.
    for guard_id in ('sample', 'empty', 'invalid', 'schema', 'deterministic', 'shape'):
        check(guard_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(raw_text).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return set(a.keys()) == set(b.keys()) and all(exact(a[k], b[k]) for k in b)
        return a == b
    def invalid_json():
        return {"ok": False, "data": None, "errors": ["invalid_json"]}
    fixtures = [
        ('sample', [(
            '{"name": " Amy ", "age": 30, "email": "a@x.com", "extra": 1}',
            {"ok": True, "data": {"name": "Amy", "age": 30, "email": "a@x.com"}, "errors": []})]),
        ('empty', [('', invalid_json()), ('   ', invalid_json())]),
        ('invalid', [(None, invalid_json()), (123, invalid_json()),
                     ('[1, 2]', {"ok": False, "data": None, "errors": ["not_an_object"]})]),
        ('schema', [(
            '{"age": 25, "email": "bad"}',
            {"ok": False, "data": None, "errors": ["missing_name", "bad_email"]})]),
        # Deterministic safeguard: error order follows the canonical schema
        # field order (name, age, email), never the input's key order.
        ('deterministic', [(
            '{"email": "not-an-email", "age": true, "name": ""}',
            {"ok": False, "data": None, "errors": ["bad_name", "bad_age", "bad_email"]})]),
        ('shape', [(
            '{"name": "Zed", "age": 0, "email": "z@w"}',
            {"ok": True, "data": {"name": "Zed", "age": 0, "email": "z@w"}, "errors": []})]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                # Deterministic: the same input must always produce the same output.
                again = solve(copy.deepcopy(value))
                if not exact(actual, expected) or not exact(again, actual) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500] + ' (output must be deterministic and input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const llmProjectSuite = String.raw`
import ast
import copy
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
    # Fail closed with a COMPLETE check list before the submission is touched.
    for project_id in ('passthrough', 'retry', 'invalid-body', 'exhausted', 'shape'):
        check(project_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(model, prompt).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}

    class FakeModel:
        # Deterministic scripted stand-in for an LLM. No network, no randomness.
        def __init__(self, script):
            self.script = list(script)
            self.calls = []
        def __call__(self, prompt, attempt):
            self.calls.append((prompt, attempt))
            if len(self.calls) > 20:
                raise RuntimeError('model call budget exceeded')
            if self.script:
                return self.script.pop(0)
            return ''

    GOOD = '{"name": "Amy", "age": 30, "email": "a@x.com"}'
    GOOD_DATA = {"name": "Amy", "age": 30, "email": "a@x.com"}
    cases = [
        ('passthrough', ["good"],
         {"ok": True, "data": GOOD_DATA, "errors": [], "attempts": 1}, 1),
        ('retry', ["not json", GOOD],
         {"ok": True, "data": GOOD_DATA, "errors": [], "attempts": 2}, 2),
        ('invalid-body', ['{"name": 123, "age": 30, "email": "a@b"}'] * 3,
         {"ok": False, "data": None, "errors": ["bad_name"], "attempts": 3}, 3),
        ('exhausted', ["not json"] * 5,
         {"ok": False, "data": None, "errors": ["invalid_json"], "attempts": 3}, 3),
        ('shape', [GOOD],
         {"ok": True, "data": GOOD_DATA, "errors": [], "attempts": 1}, 1),
    ]
    execution_ok = True
    for identifier, script, expected, expected_calls in cases:
        errors = []
        try:
            model = FakeModel([GOOD if item == "good" else item for item in script])
            # The suite substitutes the GOOD payload; the learner never sees it.
            actual = solve(model, 'extract the user profile')
            if type(actual) is not dict or set(actual.keys()) != {'ok', 'data', 'errors', 'attempts'}:
                errors.append('Expected a dict with keys ok/data/errors/attempts; received ' + repr(actual)[:300])
            else:
                normalized = dict(actual)
                if normalized.get('data') is not None and type(normalized['data']) is dict:
                    normalized['data'] = {k: normalized['data'][k] for k in ('name', 'age', 'email') if k in normalized['data']}
                if normalized != expected:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
            if len(model.calls) != expected_calls:
                errors.append('Expected %d model call(s); observed %d' % (expected_calls, len(model.calls)))
        except BaseException:
            execution_ok = False
            errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const recoveryProjectSuite = String.raw`
import ast
import builtins
import json
import os
import re
import tempfile
import traceback

ERROR_LINE = re.compile(r"^([A-Za-z_]\w*(?:Error|Exception))\s*:")

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list before the submission is touched.
    for project_id in ('concept-open', 'concept-with', 'sample', 'no-crash', 'empty', 'missing', 'shape'):
        check(project_id, False, 'The submission could not be loaded.')
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
        with_open_found = False
        open_called = False
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
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else (func.attr if isinstance(func, ast.Attribute) else '')
                if name == 'open' and consumes_result(node) and node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0])):
                    open_called = True
        namespace = {'__name__': '__submission__', 'open': tracking_open}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(path).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-open', open_called, '' if open_called else 'Call open(path) with the input path on the executed data path and use the result. Unused or constant-only calls do not count.')
    execution_ok = True
    sample_lines = [
        '{"traceback": "Traceback (most recent call last):\\n  File \\"a.py\\", line 1, in <module>\\n    1/0\\nZeroDivisionError: division by zero"}',
        '{"traceback": "Traceback (most recent call last):\\n  File \\"b.py\\", line 2, in <module>\\n    x\\nNameError: name \'x\' is not defined"}',
        '{"traceback": "no traceback here"}',
        'not json at all',
        '{"other": 1}',
    ]
    sample_expected = {'ZeroDivisionError': 1, 'NameError': 1, 'unparsed': 3}
    hostile_lines = [
        '{"traceback": 123}',
        '[1, 2]',
        '',
        '{"traceback": null}',
        '{"traceback": "Traceback (most recent call last):\\n  File \\"c.py\\", line 1\\n    pass\\n"}',
    ]
    builtins.open = tracking_open
    try:
        with tempfile.TemporaryDirectory() as tmp:
            sample_path = os.path.join(tmp, 'sample.log')
            with real_open(sample_path, 'w') as handle:
                handle.write('\n'.join(sample_lines) + '\n')
            hostile_path = os.path.join(tmp, 'hostile.log')
            with real_open(hostile_path, 'w') as handle:
                handle.write('\n'.join(hostile_lines) + '\n')
            empty_path = os.path.join(tmp, 'empty.log')
            with real_open(empty_path, 'w') as handle:
                handle.write('')
            def exact(a, b):
                return type(a) is type(b) is dict and set(a.keys()) == set(b.keys()) and all(type(a[k]) is int and a[k] == b[k] for k in b)
            entered.clear()
            try:
                actual = solve(sample_path)
                check('sample', exact(actual, sample_expected), '' if exact(actual, sample_expected) else 'Expected ' + repr(sample_expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                check('sample', False, traceback.format_exc())
            if with_open_found and entered:
                check('concept-with', True)
            else:
                check('concept-with', False, 'Open the log file inside a with statement on the executed path so it always closes.')
            try:
                actual = solve(hostile_path)
                ok = type(actual) is dict and all(type(k) is str and type(v) is int for k, v in actual.items())
                check('no-crash', ok, '' if ok else 'Hostile lines must be counted, never raised through; received ' + repr(actual)[:300])
            except BaseException:
                execution_ok = False
                check('no-crash', False, traceback.format_exc())
            try:
                actual = solve(empty_path)
                check('empty', exact(actual, {}), '' if exact(actual, {}) else 'Expected {}; received ' + repr(actual)[:200])
            except BaseException:
                execution_ok = False
                check('empty', False, traceback.format_exc())
            missing_errors = []
            for value in (os.path.join(tmp, 'missing.log'), None, 123):
                try:
                    actual = solve(value)
                    if not exact(actual, {}):
                        missing_errors.append('solve(' + repr(value)[:60] + ') returned ' + repr(actual)[:200] + '; expected {}')
                except BaseException:
                    execution_ok = False
                    missing_errors.append(traceback.format_exc())
            check('missing', not missing_errors, '\n'.join(missing_errors))
            try:
                actual = solve(sample_path)
                shape_ok = type(actual) is dict and all(type(k) is str and type(v) is int for k, v in actual.items())
                check('shape', shape_ok, '' if shape_ok else 'Return a dict mapping error names to integer counts; received ' + repr(actual)[:300])
            except BaseException:
                execution_ok = False
                check('shape', False, traceback.format_exc())
    finally:
        builtins.open = real_open
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const validationProjectSuite = String.raw`
import ast
import copy
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
    # Fail closed with a COMPLETE check list before the submission is touched.
    for project_id in ('concept-reuse', 'sample', 'empty', 'invalid', 'reasons', 'shape'):
        check(project_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        helpers = {node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name != 'solve'}
        called = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == 'solve':
                for child in ast.walk(node):
                    if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
                        called.add(child.func.id)
        reuse = bool(helpers & called)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(records).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-reuse', reuse, '' if reuse else 'Define at least one helper validator and call it from solve. Inlining every check inside solve does not demonstrate reusable validation.')
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return set(a.keys()) == set(b.keys()) and all(exact(a[k], b[k]) for k in b)
        return a == b
    fixtures = [
        ('sample', [(
            [{"username": " amy ", "email": "a@x.com", "age": 30},
             {"username": "bo", "email": "b@x.com", "age": 25},
             {"username": "cat", "email": "bad", "age": -1},
             "junk",
             {"username": "dee_99", "email": "d@x.com", "age": 40}],
            {"valid": [{"username": "amy", "email": "a@x.com", "age": 30},
                        {"username": "dee_99", "email": "d@x.com", "age": 40}],
             "errors": [{"index": 1, "reasons": ["username:bad-length"]},
                        {"index": 2, "reasons": ["email:bad-format", "age:out-of-range"]},
                        {"index": 3, "reasons": ["not-a-record"]}]})]),
        ('empty', [([], {"valid": [], "errors": []}), (None, {"valid": [], "errors": []})]),
        ('invalid', [(
            [{"username": "ok", "email": "e@x.com", "age": True},
             {"username": "fine_user", "email": "f@x.com", "age": 121}],
            {"valid": [],
             "errors": [{"index": 0, "reasons": ["username:bad-length", "age:not-an-int"]},
                        {"index": 1, "reasons": ["age:out-of-range"]}]})]),
        ('reasons', [(
            [{"username": "x", "email": "nope", "age": 5}],
            {"valid": [],
             "errors": [{"index": 0, "reasons": ["username:bad-length", "email:bad-format", "age:out-of-range"]}]})]),
        ('shape', [(
            [{"username": " zed ", "email": "z@w.com", "age": 99, "extra": 1}],
            {"valid": [{"username": "zed", "email": "z@w.com", "age": 99}], "errors": []})]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                if not exact(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;

export const transformProjectSuite = String.raw`
import ast
import copy
import json
import traceback
from decimal import Decimal as GraderDecimal

def grade(source):
    checks = []
    def check(identifier, passed, detail=''):
        entry = {'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail}
        for index, existing in enumerate(checks):
            if existing['id'] == identifier:
                checks[index] = entry
                return
        checks.append(entry)
    # Fail closed with a COMPLETE check list before the submission is touched.
    for project_id in ('concept-comprehension', 'sample', 'empty', 'invalid', 'precision', 'shape'):
        check(project_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        comprehension = any(isinstance(node, (ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp)) for node in ast.walk(tree))
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve):
            raise ValueError('Define a callable solve(catalog).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-comprehension', comprehension, '' if comprehension else 'Use at least one comprehension (list, dict, set, or generator) in your transformation.')
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return set(a.keys()) == set(b.keys()) and all(exact(a[k], b[k]) for k in b)
        return a == b
    fixtures = [
        ('sample', [(
            [{"category": " books ", "products": [
                {"name": "Atlas", "variants": [{"sku": "A1", "price": "12.50"}, {"sku": "", "price": "9.99"}]},
                {"name": "", "variants": [{"sku": "B1", "price": "5.00"}]}]},
             {"category": "x", "products": None},
             "junk"],
            [{"category": "books", "product": "Atlas", "sku": "A1", "price": "12.50"}])]),
        ('empty', [([], []), (None, []), ("text", [])]),
        ('invalid', [(
            [{"category": "c", "products": [
                {"name": "p", "variants": [{"sku": "S1", "price": "bad"}, {"sku": "S2", "price": "-1.00"},
                                           {"sku": "S3", "price": "1.005"}, {"sku": 7, "price": "2.00"}]}]}],
            [])]),
        ('precision', [(
            [{"category": "c", "products": [{"name": "p", "variants": [
                {"sku": "S1", "price": "2.675"}, {"sku": "S2", "price": "0.10"}]}]}],
            [{"category": "c", "product": "p", "sku": "S2", "price": "0.10"}])]),
        ('shape', [(
            [{"category": " b ", "products": [{"name": " n ", "variants": [{"sku": " s ", "price": "1.00", "extra": 1}]}]}],
            [{"category": "b", "product": "n", "sku": "s", "price": "1.00"}])]),
    ]
    execution_ok = True
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                before = copy.deepcopy(value)
                actual = solve(value)
                if not exact(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:500] + ' (input must remain unchanged)')
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
