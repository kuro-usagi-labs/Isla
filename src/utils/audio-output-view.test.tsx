import { renderToStaticMarkup } from 'react-dom/server';
import { describe,expect,it } from 'vitest';
import { SettingsView } from '../components/SettingsView';
import { islaBridge } from '../services/bridge';

const initial = await islaBridge.getInitialAppState();
const noop = () => {};
const base = { settings: initial.settings,folders: [],stats: initial.stats,accentColor:'#6759BA',isScanning:false,
  onUpdateSettings: async()=>{},onAddMusicFolder:noop,onImportAudioFiles:noop,onRescanLibrary:noop,onRemoveFolder:noop,onCleanMissingTracks:noop,onMinimizeToTray:noop,onQuitApplication:noop };
describe('audio output settings',()=>{
  it('shows both active outputs and distinguishes the Windows default from an explicit route',()=>{
    const html = renderToStaticMarkup(<SettingsView {...base} settings={{...initial.settings,outputDevice:'Speakers'}} outputDevices={[{name:'Headphones',isDefault:true},{name:'Speakers',isDefault:false}]} />);
    expect(html).toContain('Headphones');expect(html).toContain('Speakers');expect(html).toContain('(Windows default)');
    expect(html).toContain('Only Isla uses this output.');expect(html).toContain('aria-label="Refresh audio outputs"');
  });
  it('retains a disconnected selected output instead of displaying System Default as selected',()=>{
    const html = renderToStaticMarkup(<SettingsView {...base} settings={{...initial.settings,outputDevice:'USB Headset'}} outputDevices={[{name:'Speakers',isDefault:true}]} />);
    expect(html).toMatch(/value="USB Headset"[^>]*selected=""/);
    expect(html).toContain('(Disconnected)');expect(html).toContain('Selected output is disconnected.');
  });
  it('explains automatic routing only for System Default',()=>{
    const html = renderToStaticMarkup(<SettingsView {...base} settings={{...initial.settings,outputDevice:''}} outputDevices={[]} />);
    expect(html).toContain('Automatically follows your Windows default output.');
  });
});
