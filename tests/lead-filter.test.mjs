import test from 'node:test';
import assert from 'node:assert/strict';
import {isLeadFitName,isLeadFitGroup} from '../dist/vk-data.js';

const row = name => ({id: 1, name});

test('noise words never match inside delivery, work or place names',()=>{
 for(const name of ['Доставка цветов','Отделочные работы','Маникюр Чита','Детский центр Тигр','Кофейня Сливки'])assert.equal(isLeadFitName(row(name)),true,name);
 for(const name of ['Магазин ботов','Магазин читов','Студия мемов','Ставки спорт','Магазин сливы','Магазин игры'])assert.equal(isLeadFitName(row(name)),false,name);
});

test('lead filter keeps explicit commercial niches', () => {
  for (const name of ['Ресницы Анны', 'Психолог Мария', 'Мебель на заказ', 'Диваны и кухни', 'Салон красоты', 'Ремонт квартир']) {
    assert.equal(isLeadFitName(row(name)), true, name);
  }
});

test('lead filter rejects generic and platform names', () => {
  for (const name of ['Мама', 'Ozon', 'Мама Оля', 'Wildberries', 'АБВГД ЕЖЗИК', 'Группа 123']) {
    assert.equal(isLeadFitName(row(name)), false, name);
  }
});

test('generic business words need a meaningful second word', () => {
  assert.equal(isLeadFitName(row('Студия')), false);
  assert.equal(isLeadFitName(row('Студия Анны')), true);
  assert.equal(isLeadFitName(row('Компания')), false);
  assert.equal(isLeadFitName(row('Компания Ремонт Домов')), true);
});

test('group filter still rejects deleted or non-niche rows', () => {
  assert.equal(isLeadFitGroup({id: 1, name: 'Психолог Елена'}), true);
  assert.equal(isLeadFitGroup({id: 2, name: 'delete'}), false);
  assert.equal(isLeadFitGroup({id: 3, name: '妈妈 店'}), false);
});
