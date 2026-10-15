$f = Get-Content 'C:\Users\狮子\Desktop\futcion\сканер_кьр_терминал_игровой_банк_работает_отилчно.html'
Write-Output "Total lines: $($f.Count)"
Write-Output "Line 608 len: $($f[607].Length)"
# Write line 608 to a file
$f[607] | Out-File -FilePath 'C:\Users\狮子\qwerty\personal-bank\line608.txt' -Encoding utf8 -NoNewline
# Find the closing </script> after line 610
$endLine = -1
for ($i = 610; $i -lt $f.Count; $i++) {
    if ($f[$i].Trim() -eq '</script>') {
        $endLine = $i
        break
    }
}
Write-Output "jsQR script ends at line: $($endLine + 1)"
# Write jsQR lines 611 to endLine to a file
$jsqr = $f[610..$endLine] -join "`n"
$jsqr | Out-File -FilePath 'C:\Users\狮子\qwerty\personal-bank\jsqr.txt' -Encoding utf8 -NoNewline
