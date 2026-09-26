// Checkpoint-assessment code graders. Each suite is self-contained and fail-closed:
// every required check is pre-registered as failed before the submission is touched,
// so a submission that cannot be parsed or loaded yields a well-formed graded result
// instead of a truncated one the protocol would misclassify as infrastructure noise.
// As with the other suites, these are educational checks, not a hostile-code boundary.
export const foundationsDebugSuite = String.raw`
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
    for required_id in ('concept-except', 'sample', 'empty', 'invalid', 'types', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        except_valueerror = False
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler):
                handler_type = node.type
                names = []
                if isinstance(handler_type, ast.Name):
                    names = [handler_type.id]
                elif isinstance(handler_type, ast.Tuple):
                    names = [elt.id for elt in handler_type.elts if isinstance(elt, ast.Name)]
                if 'ValueError' in names:
                    except_valueerror = True
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        clean_users = namespace.get('clean_users')
        if not callable(clean_users):
            raise ValueError('Define a callable clean_users(rows).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    check('concept-except', except_valueerror,
          '' if except_valueerror else 'No except clause names ValueError; int() raises ValueError on non-numeric ages, not KeyError.')
    execution_ok = True
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
        return a == b
    fixtures = [
        ('sample', [(
            ([{'name': ' Ana ', 'age': '30'}, {'name': 'Bo', 'age': 'abc'}, {'name': 'Cy', 'age': '0'},
              {'name': '', 'age': '5'}, {'age': '9'}, {'name': 'De', 'age': '-2'},
              {'name': 7, 'age': '3'}, 'junk', None],),
            [{'name': 'Ana', 'age': 30}, {'name': 'Cy', 'age': 0}])]),
        ('empty', [(([],), [])]),
        ('invalid', [(( 'not a list',), []), ((None,), []),
                     (([{'name': 'E', 'age': '1.5'}, {'name': 'F', 'age': None}, None, 42],), [])]),
        ('types', [(([{'name': 'G', 'age': 42}, {'name': 'H', 'age': ' 7 '}, {'name': 'I', 'age': '0'}],),
                    [{'name': 'G', 'age': 42}, {'name': 'H', 'age': 7}, {'name': 'I', 'age': 0}])]),
        ('shape', [(([{'name': ' J ', 'age': '1'}],), [{'name': 'J', 'age': 1}])]),
    ]
    for identifier, cases in fixtures:
        errors = []
        for args, expected in cases:
            try:
                actual = clean_users(*args)
                if not exact(actual, expected):
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const foundationsScratchSuite = String.raw`
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
    for required_id in ('sample', 'empty', 'invalid', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        dedupe_names = namespace.get('dedupe_names')
        if not callable(dedupe_names):
            raise ValueError('Define a callable dedupe_names(names).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
        return a == b
    fixtures = [
        ('sample', [(([' Alice ', 'bob', 'Alice', '', '  ', 'BOB', 42, None, 'bob '],),
                     ['Alice', 'bob', 'BOB'])]),
        ('empty', [(([],), [])]),
        ('invalid', [(( 'nope',), []), ((None,), []), (([None, 1, 2.5, [], {}],), [])]),
    ]
    for identifier, cases in fixtures:
        errors = []
        for args, expected in cases:
            try:
                actual = dedupe_names(*args)
                if not exact(actual, expected):
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    shape_errors = []
    try:
        shaped = dedupe_names([' x ', 1, 'x', ' y ', None])
        if not (type(shaped) is list and all(type(item) is str for item in shaped)
                and all(item == item.strip() for item in shaped)
                and len(shaped) == len(set(shaped))):
            shape_errors.append('Expected a list of unique stripped strings; received ' + repr(shaped)[:200])
    except BaseException:
        execution_ok = False
        shape_errors.append(traceback.format_exc())
    check('shape', not shape_errors, '\n'.join(shape_errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const foundationsProjectSuite = String.raw`
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
    for required_id in ('concept-with', 'sample', 'empty', 'malformed', 'case', 'shape', 'missing-file'):
        check(required_id, False, 'The submission could not be loaded.')
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
        build_report = namespace.get('build_report')
        if not callable(build_report):
            raise ValueError('Define a callable build_report(path).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
        return a == b
    builtins.open = tracking_open
    try:
        with tempfile.TemporaryDirectory() as tmp:
            sample_path = os.path.join(tmp, 'sample.log')
            with real_open(sample_path, 'w') as handle:
                handle.write('INFO: started\nERROR: disk full\nbroken line\nERROR: disk full\nWARN: slow\nERROR: timeout\n')
            empty_path = os.path.join(tmp, 'empty.log')
            with real_open(empty_path, 'w') as handle:
                handle.write('')
            malformed_path = os.path.join(tmp, 'malformed.log')
            with real_open(malformed_path, 'w') as handle:
                handle.write('no colon here\n: empty level\nINFO: ok\n\n')
            case_path = os.path.join(tmp, 'case.log')
            with real_open(case_path, 'w') as handle:
                handle.write('error: x\nError: y\nERROR: z\n')
            entered.clear()
            cases = [
                ('sample', sample_path, {'levels': {'INFO': 1, 'ERROR': 3, 'WARN': 1}, 'errors': ['disk full', 'timeout'], 'malformed': 1}),
                ('empty', empty_path, {'levels': {}, 'errors': [], 'malformed': 0}),
                ('malformed', malformed_path, {'levels': {'INFO': 1}, 'errors': [], 'malformed': 2}),
                ('case', case_path, {'levels': {'ERROR': 3}, 'errors': ['x', 'y', 'z'], 'malformed': 0}),
            ]
            for identifier, path, expected in cases:
                try:
                    actual = build_report(path)
                    if not exact(actual, expected):
                        check(identifier, False, 'Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                    else:
                        check(identifier, True)
                except BaseException:
                    execution_ok = False
                    check(identifier, False, traceback.format_exc())
            try:
                shaped = build_report(sample_path)
                shape_ok = (type(shaped) is dict and set(shaped.keys()) == {'levels', 'errors', 'malformed'}
                            and type(shaped['levels']) is dict and type(shaped['errors']) is list
                            and type(shaped['malformed']) is int)
                check('shape', shape_ok,
                      '' if shape_ok else 'Expected exactly the keys levels/errors/malformed; received ' + repr(shaped)[:200])
            except BaseException:
                execution_ok = False
                check('shape', False, traceback.format_exc())
            if with_open_found and entered:
                check('concept-with', True)
            else:
                reasons = []
                if not with_open_found:
                    reasons.append('No with-statement wrapping an open(...) call was found.')
                if not entered:
                    reasons.append('No file opened during the graded calls was entered as a context manager; open the file with "with open(...) as ...".')
                check('concept-with', False, ' '.join(reasons))
            missing = os.path.join(tmp, 'missing.log')
            try:
                result = build_report(missing)
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
export const dataDebugSuite = String.raw`
import ast
import csv
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
    for required_id in ('concept-csv', 'concept-decimal', 'sample', 'empty', 'header', 'invalid', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    real_dict_reader = csv.DictReader
    csv_calls = []
    class TrackingDictReader(real_dict_reader):
        def __init__(self, *args, **kwargs):
            csv_calls.append(args)
            super().__init__(*args, **kwargs)
    import decimal as decimal_module
    real_decimal = decimal_module.Decimal
    decimal_calls = []
    def tracking_decimal(*args, **kwargs):
        value = real_decimal(*args, **kwargs)
        if args and isinstance(args[0], str):
            decimal_calls.append(args[0])
        return value
    csv.DictReader = TrackingDictReader
    decimal_module.Decimal = tracking_decimal
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        load_orders = namespace.get('load_orders')
        if not callable(load_orders):
            raise ValueError('Define a callable load_orders(text).')
        csv_calls.clear()
        decimal_calls.clear()
        execution_ok = True
        def exact(a, b):
            if type(a) is not type(b):
                return False
            if type(b) is list:
                return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
            if type(b) is dict:
                return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
            return a == b
        fixtures = [
            ('sample', [(('id,amount,currency\na,10.50,usd\nb,abc,USD\nc,0,EUR\nd,5,GBP\ne,7.25,JPY\n',),
                         [{'id': 'a', 'amount_cents': 1050, 'currency': 'USD'},
                          {'id': 'd', 'amount_cents': 500, 'currency': 'GBP'}])]),
            ('empty', [(( '',), None), (('id,amount,currency\n',), [])]),
            ('header', [(( 'status,id\nsettled,a\n',), None), (( 'id,amount\nx,1\n',), None),
                        (( 'id,amount,currency,extra\na,1,USD,x\n',), None)]),
            ('invalid', [(('id,amount,currency\n,5,USD\nx,-3,USD\ny,1.5,usd\n',),
                          [{'id': 'y', 'amount_cents': 150, 'currency': 'USD'}]),
                         ((None,), None)]),
        ]
        for identifier, cases in fixtures:
            errors = []
            for args, expected in cases:
                try:
                    actual = load_orders(*args)
                    if not exact(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
        shape_errors = []
        try:
            shaped = load_orders('id,amount,currency\nz,2.50,EUR\n')
            if not (type(shaped) is list and len(shaped) == 1 and type(shaped[0]) is dict
                    and set(shaped[0].keys()) == {'id', 'amount_cents', 'currency'}
                    and type(shaped[0]['id']) is str and type(shaped[0]['amount_cents']) is int
                    and type(shaped[0]['currency']) is str):
                shape_errors.append('Expected [{"id": str, "amount_cents": int, "currency": str}]; received ' + repr(shaped)[:200])
        except BaseException:
            execution_ok = False
            shape_errors.append(traceback.format_exc())
        check('shape', not shape_errors, '\n'.join(shape_errors))
        check('concept-csv', bool(csv_calls),
              '' if csv_calls else 'csv.DictReader was never called with the input text; parse with the csv module instead of manual splitting.')
        check('concept-decimal', bool(decimal_calls),
              '' if decimal_calls else 'decimal.Decimal was never called with a string amount; parse money with Decimal, not float.')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    finally:
        csv.DictReader = real_dict_reader
        decimal_module.Decimal = real_decimal
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const dataScratchSuite = String.raw`
import ast
import json
import re
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
    for required_id in ('sample', 'empty', 'precision', 'invalid', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        group_totals = namespace.get('group_totals')
        if not callable(group_totals):
            raise ValueError('Define a callable group_totals(records).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    def exact(a, b):
        if type(a) is not type(b):
            return False
        if type(b) is list:
            return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
        if type(b) is dict:
            return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
        return a == b
    fixtures = [
        ('sample', [(([{'dept': 'a', 'amount': '1.10'}, {'dept': 'b', 'amount': '2'},
                       {'dept': 'a', 'amount': '0.20'}, {'dept': 'c', 'amount': 'bad'},
                       {'dept': '', 'amount': '5'}, {'x': 1}],),
                     {'a': '1.30', 'b': '2.00'})]),
        ('empty', [(([],), {})]),
        ('precision', [(([{'dept': 'p', 'amount': '2.675'}],), {'p': '2.68'}),
                       (([{'dept': 'q', 'amount': '0.1'}, {'dept': 'q', 'amount': '0.2'}, {'dept': 'q', 'amount': '0.3'}],),
                        {'q': '0.60'})]),
        ('invalid', [(( 'nope',), {}), ((None,), {}),
                     (([{'dept': 'd'}, {'dept': 'd', 'amount': None}, 'junk'],), {})]),
    ]
    for identifier, cases in fixtures:
        errors = []
        for args, expected in cases:
            try:
                actual = group_totals(*args)
                if not exact(actual, expected):
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    shape_errors = []
    try:
        shaped = group_totals([{'dept': ' s ', 'amount': '1'}])
        if not (type(shaped) is dict and set(shaped.keys()) == {'s'}
                and all(type(value) is str and re.fullmatch(r'-?\d+\.\d{2}', value) for value in shaped.values())):
            shape_errors.append('Expected {"dept": "0.00"} totals with two decimals; received ' + repr(shaped)[:200])
    except BaseException:
        execution_ok = False
        shape_errors.append(traceback.format_exc())
    check('shape', not shape_errors, '\n'.join(shape_errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const dataProjectSuite = String.raw`
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
    for required_id in ('concept-json', 'sample', 'empty', 'envelope', 'invalid', 'duplicates', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    import json as json_module
    real_loads = json_module.loads
    json_calls = []
    def tracking_loads(*args, **kwargs):
        if args and isinstance(args[0], str):
            json_calls.append(args[0])
        return real_loads(*args, **kwargs)
    json_module.loads = tracking_loads
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        reconcile_manifest = namespace.get('reconcile_manifest')
        if not callable(reconcile_manifest):
            raise ValueError('Define a callable reconcile_manifest(manifest_text, confirmed_json).')
        json_calls.clear()
        execution_ok = True
        def exact(a, b):
            if type(a) is not type(b):
                return False
            if type(b) is list:
                return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
            if type(b) is dict:
                return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
            return a == b
        sample_manifest = 'id,status\na,settled\nb,pending\nc,settled\n'
        fixtures = [
            ('sample', [((sample_manifest, '["a", "c", "zzz"]'),
                         {'matched': ['a', 'c'], 'missing': [], 'unexpected': ['zzz']})]),
            ('empty', [(( 'id,status\n', '[]'),
                        {'matched': [], 'missing': [], 'unexpected': []})]),
            ('envelope', [((sample_manifest, 'not json'),
                           {'matched': [], 'missing': [], 'unexpected': []}),
                          ((sample_manifest, '{"a": 1}'),
                           {'matched': [], 'missing': [], 'unexpected': []}),
                          ((sample_manifest, None),
                           {'matched': [], 'missing': [], 'unexpected': []})]),
            ('invalid', [(( 'id,status\na,settled\nb,weird\n,settled\nc,pending\n', '["a", "b", "c"]'),
                          {'matched': ['a'], 'missing': [], 'unexpected': ['b']})]),
            ('duplicates', [(( 'id,status\nx,pending\n x ,settled\ny,settled\ny,settled\n', '["y"]'),
                             {'matched': ['y'], 'missing': [], 'unexpected': []})]),
        ]
        for identifier, cases in fixtures:
            errors = []
            for args, expected in cases:
                try:
                    actual = reconcile_manifest(*args)
                    if not exact(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
        shape_errors = []
        try:
            shaped = reconcile_manifest(sample_manifest, '["a"]')
            if not (type(shaped) is dict and set(shaped.keys()) == {'matched', 'missing', 'unexpected'}
                    and all(type(shaped[key]) is list and shaped[key] == sorted(shaped[key])
                            and all(type(item) is str for item in shaped[key]) for key in shaped)):
                shape_errors.append('Expected sorted string lists under matched/missing/unexpected; received ' + repr(shaped)[:200])
        except BaseException:
            execution_ok = False
            shape_errors.append(traceback.format_exc())
        check('shape', not shape_errors, '\n'.join(shape_errors))
        check('concept-json', bool(json_calls),
              '' if json_calls else 'json.loads was never called on the confirmed payload; parse it with the json module.')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    finally:
        json_module.loads = real_loads
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const appliedDebugSuite = String.raw`
import ast
import json
import re
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
    for required_id in ('concept-decimal', 'sample', 'empty', 'invalid', 'currency', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    import decimal as decimal_module
    real_decimal = decimal_module.Decimal
    decimal_calls = []
    def tracking_decimal(*args, **kwargs):
        value = real_decimal(*args, **kwargs)
        if args and isinstance(args[0], str):
            decimal_calls.append(args[0])
        return value
    decimal_module.Decimal = tracking_decimal
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        validate_payouts = namespace.get('validate_payouts')
        if not callable(validate_payouts):
            raise ValueError('Define a callable validate_payouts(records).')
        decimal_calls.clear()
        execution_ok = True
        def exact(a, b):
            if type(a) is not type(b):
                return False
            if type(b) is list:
                return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
            if type(b) is dict:
                return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
            return a == b
        fixtures = [
            ('sample', [(([{'id': ' a ', 'amount': '10.50', 'currency': 'usd'},
                             {'id': 'b', 'amount': '3', 'currency': 'EUR'},
                             {'id': 'c', 'amount': '1.234', 'currency': 'USD'},
                             {'id': 'd', 'amount': '-5', 'currency': 'USD'},
                             {'id': 'e', 'amount': '2', 'currency': 'JPY'},
                             {'id': '', 'amount': '1', 'currency': 'USD'}, 'junk'],),
                         [{'id': 'a', 'amount': '10.50', 'currency': 'USD'},
                          {'id': 'b', 'amount': '3.00', 'currency': 'EUR'}])]),
            ('empty', [(([],), [])]),
            ('invalid', [(( 'nope',), []), ((None,), []),
                         (([{'id': 'f', 'amount': '0', 'currency': 'USD'}],), []),
                         (([{'id': 'g', 'amount': 'xx', 'currency': 'USD'}],), [])]),
            ('currency', [(([{'id': 'h', 'amount': '1', 'currency': 'gbp'},
                              {'id': 'i', 'amount': '1', 'currency': ' Eur '}],),
                           [{'id': 'h', 'amount': '1.00', 'currency': 'GBP'},
                            {'id': 'i', 'amount': '1.00', 'currency': 'EUR'}])]),
            ('money', [(([{'id': 'j', 'amount': '1.234', 'currency': 'USD'}],), []),
                       (([{'id': 'k', 'amount': '2.675', 'currency': 'USD'}],), []),
                       (([{'id': 'l', 'amount': '2.67', 'currency': 'USD'}],),
                        [{'id': 'l', 'amount': '2.67', 'currency': 'USD'}])]),
        ]
        for identifier, cases in fixtures:
            errors = []
            for args, expected in cases:
                try:
                    actual = validate_payouts(*args)
                    if not exact(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
        shape_errors = []
        try:
            shaped = validate_payouts([{'id': ' s ', 'amount': '1', 'currency': 'usd'}])
            if not (type(shaped) is list and len(shaped) == 1 and type(shaped[0]) is dict
                    and set(shaped[0].keys()) == {'id', 'amount', 'currency'}
                    and shaped[0]['id'] == 's' and shaped[0]['currency'] == 'USD'
                    and type(shaped[0]['amount']) is str and re.fullmatch(r'-?\d+\.\d{2}', shaped[0]['amount'])):
                shape_errors.append('Expected [{"id": str, "amount": "0.00", "currency": str}]; received ' + repr(shaped)[:200])
        except BaseException:
            execution_ok = False
            shape_errors.append(traceback.format_exc())
        check('shape', not shape_errors, '\n'.join(shape_errors))
        check('concept-decimal', bool(decimal_calls),
              '' if decimal_calls else 'decimal.Decimal was never called with a string amount; validate money with Decimal, not float.')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    finally:
        decimal_module.Decimal = real_decimal
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const appliedScratchSuite = String.raw`
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
    for required_id in ('boundary-199', 'boundary-200', 'boundary-299', 'boundary-300', 'retry-429', 'retry-500', 'client-404', 'invalid'):
        check(required_id, False, 'The submission could not be loaded.')
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        classify_status = namespace.get('classify_status')
        if not callable(classify_status):
            raise ValueError('Define a callable classify_status(status).')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    execution_ok = True
    fixtures = [
        ('boundary-199', [((199,), 'fail')]),
        ('boundary-200', [((200,), 'success')]),
        ('boundary-299', [((299,), 'success')]),
        ('boundary-300', [((300,), 'fail'), ((399,), 'fail')]),
        ('retry-429', [((429,), 'retry')]),
        ('retry-500', [((500,), 'retry'), ((503,), 'retry'), ((599,), 'retry')]),
        ('client-404', [((404,), 'fail'), ((400,), 'fail'), ((418,), 'fail')]),
        ('invalid', [(( '200',), 'fail'), ((None,), 'fail'), ((True,), 'fail'), ((2.5,), 'fail')]),
    ]
    for identifier, cases in fixtures:
        errors = []
        for args, expected in cases:
            try:
                actual = classify_status(*args)
                if type(actual) is not type(expected) or actual != expected:
                    errors.append('classify_status(' + repr(args[0]) + '): expected ' + repr(expected) + '; received ' + repr(actual)[:200])
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
export const appliedProjectSuite = String.raw`
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
    for required_id in ('concept-json', 'sample', 'empty', 'invalid-json', 'schema', 'money', 'shape'):
        check(required_id, False, 'The submission could not be loaded.')
    import json as json_module
    real_loads = json_module.loads
    json_calls = []
    def tracking_loads(*args, **kwargs):
        if args and isinstance(args[0], str):
            json_calls.append(args[0])
        return real_loads(*args, **kwargs)
    json_module.loads = tracking_loads
    try:
        tree = ast.parse(source)
        namespace = {'__name__': '__submission__'}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        guard_payouts = namespace.get('guard_payouts')
        if not callable(guard_payouts):
            raise ValueError('Define a callable guard_payouts(lines_text).')
        json_calls.clear()
        execution_ok = True
        def exact(a, b):
            if type(a) is not type(b):
                return False
            if type(b) is list:
                return len(a) == len(b) and all(exact(x, y) for x, y in zip(a, b))
            if type(b) is dict:
                return a.keys() == b.keys() and all(exact(a[k], b[k]) for k in b)
            return a == b
        fixtures = [
            ('sample', [(('{"id":"a","amount":"1.00","currency":"USD"}\n{"id":"b","amount":"2","currency":"eur"}\nnot json\n{"id":"","amount":"1","currency":"USD"}\n',),
                         {'accepted': [{'id': 'a', 'amount': '1.00', 'currency': 'USD'},
                                       {'id': 'b', 'amount': '2.00', 'currency': 'EUR'}],
                          'fallback': 2})]),
            ('empty', [(( '',), {'accepted': [], 'fallback': 0}), (( '\n\n',), {'accepted': [], 'fallback': 0})]),
            ('invalid-json', [(( '{\n',), {'accepted': [], 'fallback': 1}),
                              (( '[1,2]\n',), {'accepted': [], 'fallback': 1})]),
            ('schema', [(('{"id":"c","amount":"1","currency":"USD","extra":1}\n{"id":"d","amount":"1"}\n',),
                         {'accepted': [{'id': 'c', 'amount': '1.00', 'currency': 'USD'}], 'fallback': 1})]),
            ('money', [(('{"id":"e","amount":"1.234","currency":"USD"}\n{"id":"f","amount":"0","currency":"USD"}\n',),
                        {'accepted': [], 'fallback': 2})]),
        ]
        for identifier, cases in fixtures:
            errors = []
            for args, expected in cases:
                try:
                    actual = guard_payouts(*args)
                    if not exact(actual, expected):
                        errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400])
                except BaseException:
                    execution_ok = False
                    errors.append(traceback.format_exc())
            check(identifier, not errors, '\n'.join(errors))
        shape_errors = []
        try:
            shaped = guard_payouts('{"id":"s","amount":"1","currency":"USD"}\n')
            if not (type(shaped) is dict and set(shaped.keys()) == {'accepted', 'fallback'}
                    and type(shaped['accepted']) is list and type(shaped['fallback']) is int):
                shape_errors.append('Expected exactly the keys accepted/fallback; received ' + repr(shaped)[:200])
        except BaseException:
            execution_ok = False
            shape_errors.append(traceback.format_exc())
        check('shape', not shape_errors, '\n'.join(shape_errors))
        check('concept-json', bool(json_calls),
              '' if json_calls else 'json.loads was never called on the input lines; parse each line with the json module.')
    except BaseException:
        return {'executionOk': False, 'tests': checks, 'error': traceback.format_exc()}
    finally:
        json_module.loads = real_loads
    return {'executionOk': execution_ok, 'tests': checks, 'error': ''}

json.dumps(grade(submission_source))
`;
