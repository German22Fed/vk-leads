// One bounded refresh of an existing observation history. Never substitute a
// freshly downloaded ID snapshot for a requested time range.
export async function refreshObservation({collector,ensureConfig,signal,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 const cancelled=()=>{if(signal?.aborted)throw Error('Поиск остановлен. История сохранена.');};
 collector.stop();
 const until=now()+15000;
 while(collector.busy&&now()<until){cancelled();await wait(100);}
 if(collector.busy)throw Error('Предыдущая проверка ещё завершается. Повторите через несколько секунд.');
 cancelled();
 if(!collector.state.config)await ensureConfig();
 cancelled();
 const run=await collector.cycle();
 cancelled();
 if(run.status!=='ok')throw Error(run.error||'Проверка остановлена. Уже сохранённая история доступна.');
 collector.start({immediate:false});
 return collector.snapshot();
}
