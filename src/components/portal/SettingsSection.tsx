import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';

/**
 * One labelled card on the Settings page. `id` is the anchor the side-nav
 * links to; `scroll-mt-*` keeps the heading clear of the top of the viewport
 * when jumped to.
 */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <Card>
        <CardHeader>
          <CardTitle id={`${id}-title`}>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children}
      </Card>
    </section>
  );
}

export default SettingsSection;
