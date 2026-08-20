import { Tabs } from 'expo-router';
import VeloraLogoMobile from '@/components/VeloraLogoMobile';
import GlowStripTabBar from '@/components/GlowStripTabBar';
import { useTheme } from '@/context/ThemeContext';

export default function TabLayout() {
  const { theme: c } = useTheme();

  const bg = c.headerBg;

  return (
    <Tabs
      tabBar={(props) => <GlowStripTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: bg },
        headerShadowVisible: false,
        headerTitle: () => <VeloraLogoMobile size="md" />,
        // backgroundColor is REQUIRED here: the 110px paddingBottom (clearance for the
        // floating tab bar) otherwise exposes React Navigation's default white scene
        // background — invisible in light mode, a glaring white band in dark mode.
        sceneStyle: { backgroundColor: c.bg, paddingBottom: 110 },
      }}
    >
      <Tabs.Screen name="index"        options={{ title: 'Dashboard'    }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transactions'  }} />
      <Tabs.Screen name="budgets"      options={{ title: 'Budgets'       }} />
      <Tabs.Screen name="savings"      options={{ title: 'Savings'       }} />
      <Tabs.Screen name="notes"        options={{ title: 'Notes'         }} />
      <Tabs.Screen name="reports"      options={{ title: 'Reports'       }} />
      <Tabs.Screen name="settings"     options={{ title: 'Settings'      }} />
      <Tabs.Screen name="import"       options={{ title: 'Import'        }} />
      <Tabs.Screen name="recurring"    options={{ title: 'Recurring'     }} />
      <Tabs.Screen name="loans"        options={{ title: 'Loans'         }} />
      <Tabs.Screen name="settlements"  options={{ title: 'Settlements'   }} />
      <Tabs.Screen name="calendar"     options={{ title: 'Calendar'      }} />
      <Tabs.Screen name="documents"    options={{ title: 'Documents'     }} />
      <Tabs.Screen name="habits"       options={{ title: 'Habits'        }} />
      <Tabs.Screen name="news"         options={{ title: 'News'          }} />
      <Tabs.Screen name="jobs"         options={{ title: 'Jobs'          }} />
      <Tabs.Screen name="ats"          options={{ title: 'ATS Check'     }} />
      <Tabs.Screen name="safety-net"   options={{ title: 'Safety Net'    }} />
      <Tabs.Screen name="stock-check"  options={{ title: 'Stock Check'   }} />
      <Tabs.Screen name="guide"        options={{ title: 'Guide'         }} />
    </Tabs>
  );
}
