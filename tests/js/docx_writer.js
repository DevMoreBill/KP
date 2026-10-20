// Документ Word без шаблона (app/web/js/features/doc/docx-writer.js): заголовки, пункты, таблица, рисунок, колонтитул — пакет
// .docx записывается в файл (путь — аргумент), его части проверяет tests/test_tz_out.py (разбор XML, связи, типы).
// Запуск: node tests/js/docx_writer.js <файл.docx>
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname, '..', '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'app', 'web', 'vendor', 'jszip.min.js'), 'utf8'), { filename:'jszip.min.js' });
global.JSZip=JSZip;
const { DocxWriter }=require(path.join(ROOT, 'app', 'web', 'js', 'features', 'doc', 'docx-writer.js'));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const d=new DocxWriter({ title:'ТЗ <проверка> & «кавычки»', author:'ООО «ПНЕВМОТЕХ»', footer:'ТЗ на сборку — станция' });
d.title1('Техническое задание на сборку станции в контейнере').para([['Станция ', { b:true }], ['DVK 37 & <поз. 1>', { i:true }]], { align:'center' });
d.heading('1. Общие сведения').items(['Пункт первый', [['Жирно: ', { b:true }], ['и обычно\nс переводом строки', {}]], '', 'Управляющие \u0001 знаки убираются'], '1.');
d.subheading('Таблица').table([12, 70, 12, 44], ['Поз.', 'Наименование', 'Кол.', 'Примечание'], [['1', 'Компрессор «А» & Б', '2', 'x < y'], ['2', [['Ресивер', { b:true }]], '1', '']]);
d.image(png, { px:1, py:1, width:100, caption:'Приложение 1. Рисунок', maxH:50 }).image('data:image/svg+xml;base64,PHN2Zz4=', { px:1, py:1, width:50, caption:'не попадёт' })
  .pageBreak().heading('Приложения').image(png.replace('image/png', 'image/jpeg'), { px:2, py:1, width:170, caption:'jpeg' });
d.pack('nodebuffer').then(b=>{ fs.writeFileSync(process.argv[2], b); console.log('docx', b.length, 'рисунков', d.media.length); })
  .catch(e=>{ console.error(e); process.exitCode=1; });
