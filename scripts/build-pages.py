"""Create a clean, allowlisted static site for GitHub Pages."""
import argparse
import hashlib
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]
CORPUS_SHA256='5075bc789ae4ac6854f85ddf1b80cf33aef583f0d0fb57892ee29c2fb056020d'
FILES=('index.html','styles.css','core.js','app.js','data/training-items.js')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'_site')
    args=parser.parse_args()
    output=args.output.resolve()
    protected=(ROOT,ROOT/'data',ROOT/'reference')
    if output in protected or any(path in output.parents for path in protected[1:]):
        raise SystemExit('Output must be a separate generated directory.')
    corpus=ROOT/'data/training-items.js'
    digest=hashlib.sha256(corpus.read_bytes()).hexdigest()
    if digest!=CORPUS_SHA256:
        raise SystemExit(f'Runtime corpus does not match final-r3: {digest}')
    expected=set(FILES)
    if output.exists():
        if any(path.is_symlink() for path in output.rglob('*')):
            raise SystemExit('Output cannot contain symbolic links.')
        existing={p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
        unexpected=existing-expected
        if unexpected:
            raise SystemExit('Output contains files outside the deployment allowlist: '+', '.join(sorted(unexpected)))
    output.mkdir(parents=True,exist_ok=True)
    for relative in FILES:
        destination=output/relative
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/relative,destination)
    actual={p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
    if actual!=expected:
        raise SystemExit(f'Unexpected site file inventory: {sorted(actual)}')
    print(f'Built {len(actual)} static files at {output}')
    print(f'Runtime corpus SHA-256 {digest}')

if __name__=='__main__':
    main()
