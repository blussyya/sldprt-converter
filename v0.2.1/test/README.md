# Tests

## Adding Test Parts

Add your own SLDPRT files to `test/fixtures/`:

```bash
cp /path/to/mypart.sldprt test/fixtures/mypart.sldprt
```

(These are `.gitignore`'d since binary parts are large)

## Running Tests

Future test suite will go here. For now, use the CLI to verify extraction:

```bash
node src/sldprt-cli.js test/fixtures/mypart.sldprt --info
```
