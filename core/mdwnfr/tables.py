"""Nested table contents and bounded light spreadsheet calculations.

Tables and cells are logical records. Placement is computed from shared word
quadrat composition, never stored in the document. Formula evaluation uses a
small AST whitelist and cannot execute Python code or read external sources.
"""
from __future__ import annotations
import ast
import re
from fractions import Fraction
from math import isfinite
from uuid import uuid4

class TableError(ValueError):
    pass

MAX_ROWS = 24
MAX_COLS = 12
MAX_CELL_WORDS = 128
NUMERAL_SIGNS = (
    (1000000,'𓁨'),(100000,'𓆐'),(10000,'𓂭'),(1000,'𓆼'),
    (100,'𓍢'),(10,'𓎆'),(1,'𓏺'))


def egyptian_number(value) -> str:
    """Standard additive Egyptian numeral notation; no Western digits."""
    if isinstance(value, Fraction) and value.denominator != 1:
        raise TableError('Non-integral result needs a fraction notation')
    if type(value) is not int and not isinstance(value, Fraction):
        raise TableError('Expected an integer numeral')
    n = int(value)
    if not 1 <= n <= 9999999:
        raise TableError('Egyptian display supports positive integers 1–9,999,999')
    result = []
    for magnitude, symbol in NUMERAL_SIGNS:
        count, n = divmod(n, magnitude)
        result.append(symbol * count)
    return ''.join(result)


def cell():
    return {'id':uuid4().hex,'mode':'text','items':[]}


def table(rows:int=2, columns:int=2, width_mm:float|None=None):
    if type(rows) is not int or type(columns) is not int or not (1<=rows<=MAX_ROWS and 1<=columns<=MAX_COLS):
        raise TableError('Table size is outside allowed bounds')
    result={'id':uuid4().hex,'type':'table','rows':[[cell() for _ in range(columns)] for _ in range(rows)],
            'x_align':0.0,'y_align':0.0,'x_offset_mm':0.0}
    if width_mm is not None:result['width_mm']=width_mm
    validate_table(result)
    return result


def validate_table(obj:dict, check_stream=None):
    rows=obj.get('rows')
    if not isinstance(rows,list) or not 1<=len(rows)<=MAX_ROWS:
        raise TableError('Table needs 1–24 rows')
    count=len(rows[0]) if isinstance(rows[0],list) else 0
    if not 1<=count<=MAX_COLS:
        raise TableError('Table needs 1–12 columns')
    width=obj.get('width_mm')
    if width is not None and (type(width) not in (int,float) or not isfinite(width) or not 15<=width<=500):
        raise TableError('Invalid table width')
    for row in rows:
        if not isinstance(row,list) or len(row)!=count:
            raise TableError('Table rows must have equal column counts')
        for entry in row:
            if not isinstance(entry,dict) or not isinstance(entry.get('id'),str) or not entry['id']:
                raise TableError('Table cells need stable IDs')
            if entry.get('mode')=='text':
                items=entry.get('items')
                if not isinstance(items,list) or len(items)>MAX_CELL_WORDS:
                    raise TableError('Too many words in a table cell')
                if any(not isinstance(o,dict) or o.get('type')!='word' for o in items):
                    raise TableError('Table text cells contain only word objects')
                if check_stream:check_stream(items)
            elif entry.get('mode')=='formula':
                expr=entry.get('formula')
                if not isinstance(expr,str) or not expr.startswith('=') or len(expr)>160 or not expr[1:]:
                    raise TableError('Formula must begin with = and have at most 160 characters')
            else:raise TableError('Unsupported table cell mode')


def cell_at(obj, row:int, col:int):
    if type(row) is not int or type(col) is not int or not (0<=row<len(obj['rows']) and 0<=col<len(obj['rows'][0])):
        raise TableError('Table cell index outside bounds')
    return obj['rows'][row][col]


def ref_location(ref:str):
    match=re.fullmatch(r'([A-L])([1-9]|1[0-9]|2[0-4])',ref.upper())
    if match is None:raise TableError('Invalid cell reference: '+ref)
    return int(match.group(2))-1,ord(match.group(1))-65


def evaluate_table(obj:dict) -> dict[tuple[int,int],int|Fraction|str]:
    """Safe formulas with arithmetic, references, and aggregate cell ranges."""
    cache={}; active=set(); rows=obj['rows']; nrows=len(rows); ncols=len(rows[0])
    def eval_cell(r,c):
        if not (0<=r<nrows and 0<=c<ncols):raise TableError('Cell reference outside table')
        key=(r,c)
        if key in active:raise TableError('Circular formula reference')
        if key in cache:return cache[key]
        active.add(key)
        try:
            entry=rows[r][c]
            if entry['mode']=='text':
                value=Fraction(0)
            else:
                formula=entry['formula'][1:].strip().upper()
                # Spreadsheet-style A1:B3 only allowed inside aggregate functions.
                formula=re.sub(r'\b([A-L](?:[1-9]|1[0-9]|2[0-4]))\s*:\s*([A-L](?:[1-9]|1[0-9]|2[0-4]))\b',
                               lambda m: f'RANGE("{m.group(1)}","{m.group(2)}")',formula)
                try:tree=ast.parse(formula,mode='eval')
                except SyntaxError as exc:raise TableError('Invalid formula syntax') from exc
                def compute(node):
                    if isinstance(node,ast.Expression):return compute(node.body)
                    if isinstance(node,ast.Constant) and type(node.value) is int and abs(node.value)<=9999999:
                        return Fraction(node.value)
                    if isinstance(node,ast.Name):
                        rr,cc=ref_location(node.id);return eval_cell(rr,cc)
                    if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
                        v=scalar(compute(node.operand));return v if isinstance(node.op,ast.UAdd) else -v
                    if isinstance(node,ast.BinOp) and isinstance(node.op,(ast.Add,ast.Sub,ast.Mult,ast.Div)):
                        a,b=scalar(compute(node.left)),scalar(compute(node.right))
                        if isinstance(node.op,ast.Add):ans=a+b
                        elif isinstance(node.op,ast.Sub):ans=a-b
                        elif isinstance(node.op,ast.Mult):ans=a*b
                        else:
                            if b==0:raise TableError('Division by zero')
                            ans=a/b
                        if abs(ans)>9999999:raise TableError('Formula result exceeds display limit')
                        return ans
                    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and not node.keywords:
                        name=node.func.id
                        if name=='RANGE' and len(node.args)==2 and all(isinstance(a,ast.Constant) and isinstance(a.value,str) for a in node.args):
                            r1,c1=ref_location(node.args[0].value);r2,c2=ref_location(node.args[1].value)
                            if r1>r2 or c1>c2 or r2>=nrows or c2>=ncols:raise TableError('Invalid formula range')
                            return [eval_cell(y,x) for y in range(r1,r2+1) for x in range(c1,c2+1)]
                        if name in ('SUM','AVERAGE','MIN','MAX'):
                            values=[]
                            for arg in node.args:
                                val=compute(arg)
                                values.extend(val if isinstance(val,list) else [val])
                            values=[scalar(v) for v in values]
                            if not values:raise TableError('Empty aggregate')
                            if name=='SUM':return sum(values,Fraction(0))
                            if name=='AVERAGE':return sum(values,Fraction(0))/len(values)
                            if name=='MIN':return min(values)
                            return max(values)
                    raise TableError('Unsupported formula expression')
                def scalar(v):
                    if not isinstance(v,Fraction):raise TableError('Expected numeric scalar')
                    return v
                value=compute(tree)
                if not isinstance(value,Fraction):raise TableError('Formula result is not a number')
            cache[key]=value
            return value
        finally:active.remove(key)
    for r in range(nrows):
        for c in range(ncols):
            try:eval_cell(r,c)
            except TableError as exc:cache[(r,c)]='#ERR: '+str(exc)
    return cache


def typeset_table(obj:dict, sign_width:float, width_mm:float, usable_height:float,
                  metrics:dict|None=None, direction:str='rtl') -> dict:
    """One authoritative nested compositor, using the normal word quadrats."""
    from .quadrat import compose, _shape_ratio
    values=evaluate_table(obj)
    ncols=len(obj['rows'][0]); nrows=len(obj['rows'])
    padding=max(1.0,sign_width*.12)
    each=width_mm/ncols
    if each-2*padding<=2:raise TableError('Table columns too narrow for signs')
    calculated=[];heights=[]
    for ri,row in enumerate(obj['rows']):
        cells=[];row_height=max(sign_width*.75,6)
        for ci,entry in enumerate(row):
            words=[];formula_error=None
            if entry['mode']=='text':
                words=[(it['id'],it['signs'],it.get('color','#192433'),it.get('bold',False))
                       for it in entry['items']]
            else:
                value=values[(ri,ci)]
                try: signs=list(egyptian_number(value))
                except (TableError,TypeError) as exc:
                    signs=[];formula_error=str(exc)
                if signs:words=[(entry['id'], signs, '#192433',False)]
            advance=padding; glyphs=[]
            for oid,signs,color,bold in words:
                ratios={s:_shape_ratio(s,metrics or {}) for s in signs}
                q=compose(signs,each-2*padding,ratios)
                glyphs.append({'id':oid,'x':padding,'y':advance,'height':q.height,'quadrat':q.payload(),
                               'color':color,'bold':bold})
                advance+=q.height + padding*.5
            row_height=max(row_height,advance+padding*.5)
            cells.append({'cell_id':entry['id'],'mode':entry['mode'],'words':glyphs,
                          'error':(formula_error or values[(ri,ci)]) if entry['mode']=='formula' and
                     (formula_error or isinstance(values[(ri,ci)],str)) else None})
        calculated.append(cells);heights.append(round(row_height,5))
    total=sum(heights)
    if usable_height is not None and total>usable_height+1e-8:
        raise TableError('Table exceeds page writing height; reduce font/rows or use taller surface')
    result=[];offset=0.0
    for ri,row in enumerate(calculated):
        for ci,entry in enumerate(row):
            result.append({**entry,'row':ri,'column':ci,
                           'x':round((ncols-ci-1 if direction=='rtl' else ci)*each,5),'y':round(offset,5),
                           'width':round(each,5),'height':heights[ri]})
        offset+=heights[ri]
    return {'width_mm':round(width_mm,5),'height':round(total,5),
            'row_heights':heights,'columns':ncols,'rows':nrows,'cells':result}


# Geometry-only page segmentation: never changes the persistent table or cell IDs.
def paginate_table(geometry: dict, page_height: float) -> list[dict]:
    """Split a typeset table at common, glyph-free horizontal cutlines.

    Rows stay intact when they fit. Oversized rows can split between complete
    quadrats, provided there is a common empty horizontal line through every
    cell; otherwise the compositor raises an explicit error instead of clipping.
    """
    if page_height <= 0:
        raise TableError('Invalid table fragment height')
    total = geometry['height']
    if total <= page_height + 1e-8:
        return [dict(geometry, fragment_index=0, fragment_count=1,
                     source_top=0.0, source_bottom=total)]
    row_edges = [0.0]
    for height in geometry['row_heights']:
        row_edges.append(row_edges[-1]+height)
    # Prefer row boundaries; only split rows when a complete row cannot fit.
    glyph_intervals = sorted((cell['y']+word['y'], cell['y']+word['y']+word['height'])
        for cell in geometry['cells'] for word in cell['words'])
    limits = sorted(set(round(e,7) for e in row_edges))
    cursor=0.0
    fragments=[]
    eps=0.00001
    while cursor < total-1e-7:
        remaining=min(total,cursor+page_height)
        rows=[e for e in limits if cursor+eps<e<=remaining+eps]
        # Even if a shorter row fits, prefer full rows to avoid splitting them.
        # If no row boundary fits, find the last safe cut between quadrats.
        if rows:
            end=max(rows)
        else:
            candidates=[remaining]
            for start,finish in glyph_intervals:
                if cursor+eps < finish < remaining:
                    candidates.append(finish)
            end=None
            for candidate in sorted(set(candidates), reverse=True):
                # A cut at the exact bottom of a glyph is legal (no ink crosses).
                if candidate>cursor+eps and not any(a+eps<candidate<b-eps
                                           for a,b in glyph_intervals):
                    end=candidate
                    break
            if end is None:
                raise TableError('Table quadrat cannot fit within one page writing height')
        end=min(total,end)
        visible=[]
        heights=[]
        for ri in range(geometry['rows']):
            top,bottom=row_edges[ri],row_edges[ri+1]
            a,b=max(cursor,top),min(end,bottom)
            if b <= a+eps:continue
            heights.append(round(b-a,5))
            for cell in (c for c in geometry['cells'] if c['row']==ri):
                words=[]
                for word in cell['words']:
                    wt=cell['y']+word['y']
                    wb=wt+word['height']
                    if wt>=a-eps and wb<=b+eps:
                        words.append({**word,'y':round(wt-a,5)})
                    elif wt<b-eps and wb>a+eps:
                        raise TableError('Table pagination would split a quadrat')
                visible.append({**cell, 'y':round(a-cursor,5),
                    'height':round(b-a,5), 'words':words,
                    'continued_from_above':a>top+eps,
                    'continues_below':b<bottom-eps})
        fragments.append({'width_mm':geometry['width_mm'],
            'height':round(end-cursor,5), 'columns':geometry['columns'],
            'rows':len(heights), 'row_heights':heights,'cells':visible,
            'source_top':round(cursor,5),'source_bottom':round(end,5)})
        cursor=end
    for j,fragment in enumerate(fragments):
        fragment['fragment_index']=j
        fragment['fragment_count']=len(fragments)
    return fragments
