// Exercise-specific executable contracts. These fixtures are not model grades.
export const diagnosticContracts = {
  variables: "[('positive',' 7 ',14),('negative','-3',-6),('zero','+0',0),('unseen','126',252)]",
  strings: "[('trim','  Red Apple ','red-apple'),('repeated','a  b','a--b'),('empty','   ',''),('unicode',' ÉCOLE Bleue ','école-bleue')]",
  conditionals: "[('low',0,5),('below',19,5),('boundary',20,3),('upper',49,3),('free',50,0),('large',100,0)]",
  loops: "[('grid',[[1,2],[],[-4,8]],7),('empty',[],0),('rows',[[],[]],0),('negative',[[-5],[-2,1]],-6)]",
  functions: "[('balance',(10,[2,-4]),8),('empty',(3,[]),3),('negative',(-3,[1,1]),-1),('repeat',(10,[2,-4]),8)]",
  collections: "[('groups',[('Ada','py'),('Ada','py'),('Ada','sql'),('Bo','py')],{'Ada':2,'Bo':1}),('empty',[],{}),('case',[('a','X'),('a','x'),('b','X')],{'a':2,'b':1}),('repeat',[('x','a'),('x','a')],{'x':1})]",
  exceptions: "[('mixed',[' 3 ','bad','-1','2.5','7'],[3,-1,7]),('empty',[],[]),('invalid',['','NaN','3e2'],[]),('signed',['+0','-42','001'],[0,-42,1])]",
  reasoning: "[('first','a',['a']),('second','b',['b']),('none',None,[None]),('number',0,[0])]",
  comprehensions: "[('filtered',[-2,0,3,1],[9,1]),('empty',[],[]),('negatives',[-3,0],[]),('repeats',[2,2,5],[4,4,25])]",
  modules: "[('rounding',[2.1,-2.1,4.0],[3,-2,4]),('empty',[],[]),('zero',[0,-0.2,0.2],[0,0,1]),('whole',[-4,8],[-4,8])]",
  files: "[('lines',' Ada \\n\\nBo\\n',['Ada','Bo']),('empty','',[]),('unicode',' Café \\n\\t東京\\n ',['Café','東京']),('last',' last ',['last'])]",
  "csv-json": "[('names','[{\"name\":\"Ada, Jr.\"},{\"name\":\"Bo\"}]',['Ada, Jr.','Bo']),('empty','[]',[]),('unicode','[{\"name\":\"Éva\",\"age\":3}]',['Éva']),('spaces','[ { \"name\" : \"x y\" } ]',['x y'])]",
  classes: "[('start',4,6),('default',0,2),('negative',-3,-1),('another',10,12)]",
  http: "[('created',{'status':201,'payload':{'id':7}},{'id':7}),('lower',{'status':200,'payload':[]},[]),('upper',{'status':299,'payload':'ok'},'ok'),('missing',{'status':404,'payload':'ignored'},None),('rate',{'status':429,'payload':{}},ValueError),('server',{'status':500,'payload':{}},ValueError),('redirect',{'status':301,'payload':{}},ValueError)]",
  data: "[('refund',[{'category':'books','amount':5},{'category':'books','amount':-2}],{'books':3}),('empty',[],{}),('groups',[{'category':'a','amount':0},{'category':'b','amount':7},{'category':'a','amount':3}],{'a':3,'b':7}),('case',[{'category':'A','amount':1},{'category':'a','amount':2}],{'A':1,'a':2})]",
};
export const diagnosticGraderCatalog = Object.fromEntries(Object.keys(diagnosticContracts).map(skill => [`diag-${skill}-v1`, Object.freeze({ exerciseId: `${skill}-code`, version: "1.0.0", requiredTests: ["behavior", "edges", "contract"] })]));
export function diagnosticSuite(graderId) {
  const skill = Object.keys(diagnosticContracts).find(key => `diag-${key}-v1` === graderId);
  if (!skill) return undefined;
  return `diagnostic_skill = ${JSON.stringify(skill)}\nfixtures = ${diagnosticContracts[skill]}\n` + String.raw`
import ast, copy, json, tempfile, os, traceback
tests=[]
def check(identifier,title,passed,detail=''):
    tests.append({'id':identifier,'name':title,'required':True,'passed':bool(passed),'detail':detail})
def same(a,b):
    if type(a) is not type(b): return False
    if type(a) is list: return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))
    if type(a) is dict: return a.keys()==b.keys() and all(same(a[k],b[k]) for k in a)
    return a==b
def grade():
    try:
        tree=ast.parse(submission_source)
        observed=[]; calls=[]; aliases={}
        for node in ast.walk(tree):
            if isinstance(node,ast.Import):
                for item in node.names: aliases[item.asname or item.name]=item.name
            elif isinstance(node,ast.ImportFrom):
                for item in node.names: aliases[item.asname or item.name]=(node.module or '')+'.'+item.name
        parents={child:node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        def target(node):
            if isinstance(node,ast.Name): return aliases.get(node.id,node.id)
            if isinstance(node,ast.Attribute): return target(node.value)+'.'+node.attr
            return ''
        def observe_call(name,fn,*args,**kwargs):
            result=fn(*args,**kwargs)
            calls.append((name,args,result))
            return result
        def observe(value):
            observed.append(value)
            return value
        class Track(ast.NodeTransformer):
            def visit_Call(self,node):
                name=target(node.func)
                self.generic_visit(node)
                if name in ('math.ceil','json.loads','open'):
                    return ast.copy_location(ast.Call(func=ast.Name(id='__observe_call__',ctx=ast.Load()),args=[ast.Constant(name),node.func,*node.args],keywords=node.keywords),node)
                return node
            def visit_ListComp(self,node):
                self.generic_visit(node)
                return ast.copy_location(ast.Call(func=ast.Name(id='__observe_comprehension__',ctx=ast.Load()),args=[node],keywords=[]),node)
        transformed=ast.fix_missing_locations(Track().visit(copy.deepcopy(tree)))
        scope={'__name__':'__submission__','__observe_comprehension__':observe,'__observe_call__':observe_call}
        exec(compile(transformed,'main.py','exec'),scope)
        solve=scope.get('solve')
        if not callable(solve): raise ValueError('Define a callable solve(value).')
    except BaseException:
        return {'executionOk':False,'tests':[],'error':traceback.format_exc()}
    failures=[]; mutation=False; concept_ok=True; execution_ok=True; previous_result=None
    for name,value,expected in fixtures:
        original=copy.deepcopy(value); path=None; observed.clear(); calls.clear()
        try:
            if diagnostic_skill=='files':
                f=tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',delete=False)
                path=f.name; f.write(value); f.close(); value=path
            try:
                actual=solve(value)
                passed=not isinstance(expected,type) and same(actual,expected)
                if diagnostic_skill=='comprehensions' and expected:
                    concept_ok=concept_ok and any(actual is result for result in observed)
                if diagnostic_skill=='modules' and expected:
                    used=[result for name,args,result in calls if name=='math.ceil']
                    for number in expected:
                        if number in used: used.remove(number)
                        else: concept_ok=False
                if diagnostic_skill=='csv-json':
                    concept_ok=concept_ok and any(name=='json.loads' and args and args[0]==value and type(result) is list and [r['name'] for r in result]==expected for name,args,result in calls)
                if diagnostic_skill=='files':
                    handles=[result for name,args,result in calls if name=='open' and args and args[0]==path]
                    concept_ok=concept_ok and bool(handles) and all(handle.closed for handle in handles)
                if diagnostic_skill=='reasoning':
                    if actual is previous_result: passed=False
                    previous_result=actual
                    if type(actual) is list: actual.append('__prior_result_changed__')
            except ValueError:
                passed=expected is ValueError
            if not passed: failures.append(name+': returned behavior did not match the requirement.')
            if diagnostic_skill in ('functions','data') and value!=original: mutation=True
        except BaseException:
            execution_ok=False; failures.append(name+': '+traceback.format_exc())
        finally:
            if path: os.unlink(path)
    if diagnostic_skill=='classes':
        try:
            Counter=scope['Counter']; a,b=Counter(),Counter(8)
            concept_ok=type(Counter) is type and a.increment()==1 and a.value==1 and b.value==8 and b.increment()==9
        except BaseException: concept_ok=False
    if diagnostic_skill=='files': concept_ok=concept_ok and any(isinstance(n,ast.With) for n in ast.walk(tree))
    check('behavior','Return the requested values',not failures,'\n'.join(failures))
    check('edges','Handle boundaries, empty inputs and repeated calls',not failures,'\n'.join(failures))
    check('contract','Respect the function and required construct contract',concept_ok and not mutation,'Check required constructs, independent calls, and input preservation.' if not concept_ok or mutation else '')
    return {'executionOk':execution_ok,'tests':tests,'error':''}
json.dumps(grade())
`;
}
