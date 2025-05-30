import Feature from 'sentry/components/acl/feature';
import Breadcrumbs from 'sentry/components/breadcrumbs';
import {LinkButton} from 'sentry/components/core/button';
import {ButtonBar} from 'sentry/components/core/button/buttonBar';
import FeedbackWidgetButton from 'sentry/components/feedback/widget/feedbackWidgetButton';
import * as Layout from 'sentry/components/layouts/thirds';
import {NoAccess} from 'sentry/components/noAccess';
import PageFiltersContainer from 'sentry/components/organizations/pageFilters/container';
import SentryDocumentTitle from 'sentry/components/sentryDocumentTitle';
import {t} from 'sentry/locale';
import {useLocation} from 'sentry/utils/useLocation';
import useOrganization from 'sentry/utils/useOrganization';
import {getTitleFromLocation} from 'sentry/views/explore/contexts/pageParamsContext/title';
import {MultiQueryModeContent} from 'sentry/views/explore/multiQueryMode/content';
import {StarSavedQueryButton} from 'sentry/views/explore/starSavedQueryButton';
import {usePrefersStackedNav} from 'sentry/views/nav/usePrefersStackedNav';
import {makeTracesPathname} from 'sentry/views/traces/pathnames';

export default function MultiQueryMode() {
  const location = useLocation();
  const organization = useOrganization();
  const title = getTitleFromLocation(location);

  const prefersStackedNav = usePrefersStackedNav();

  return (
    <Feature
      features="visibility-explore-view"
      organization={organization}
      renderDisabled={NoAccess}
    >
      <SentryDocumentTitle title={t('Compare Queries')} orgSlug={organization.slug}>
        <Layout.Header>
          <Layout.HeaderContent>
            <Breadcrumbs
              crumbs={[
                {
                  label: t('Explore'),
                },
                {
                  label: t('Traces'),
                  to: makeTracesPathname({
                    organization,
                    path: '/',
                  }),
                },
                {
                  label: t('Compare Queries'),
                },
              ]}
            />
            <Layout.Title>{title ? title : t('Compare Queries')}</Layout.Title>
          </Layout.HeaderContent>
          <Layout.HeaderActions>
            <ButtonBar gap={1}>
              {!prefersStackedNav && (
                <LinkButton
                  to={`/organizations/${organization.slug}/explore/saved-queries/`}
                  size="sm"
                >
                  {t('Saved Queries')}
                </LinkButton>
              )}
              <StarSavedQueryButton />
              <FeedbackWidgetButton />
            </ButtonBar>
          </Layout.HeaderActions>
        </Layout.Header>
        <Layout.Page>
          <PageFiltersContainer>
            <MultiQueryModeContent />
          </PageFiltersContainer>
        </Layout.Page>
      </SentryDocumentTitle>
    </Feature>
  );
}
