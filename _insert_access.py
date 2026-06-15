# -*- coding: utf-8 -*-
import glob

viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'

script = r'''    <script>
(function() {
  var h = location.pathname.indexOf("/can") !== -1 ||
          location.search.indexOf("can") !== -1 ||
          location.hash === "#can";
  if (!h) {
    document.open();
    document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>访问受限<\/title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.popup{background:#fff;padding:48px 56px;border-radius:16px;box-shadow:0 4px 32px rgba(0,0,0,.1);text-align:center;max-width:420px}.popup p{font-size:17px;color:#1a1a1a;line-height:1.8;letter-spacing:.3px}<\/style><\/head><body><div class="popup"><p>网站访问权限已被回收<br>需要访问请联系网站管理员<\/p><\/div><\/body><\/html>');
    document.close();
  }
})();
</script>'''

count = 0
for f in sorted(glob.glob('*.html')):
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()

    if viewport in content:
        content = content.replace(viewport, viewport + '\n' + script)
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        count += 1
        print('OK: ' + f)
    else:
        print('MISS: ' + f + ' (viewport not found)')

print('\nUpdated ' + str(count) + ' files')
