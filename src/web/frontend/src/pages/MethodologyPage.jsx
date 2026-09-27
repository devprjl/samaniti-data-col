import Link from "../components/Link";
import Icon from "../components/Icon";
import { PageHeader, SectionHeading } from "../components/Primitives";

const dataModel = [
    {
        icon: "building",
        title: "Municipality",
        description:
            "The local government identity, province, district, and administrative profile.",
    },
    {
        icon: "file",
        title: "Policy entity",
        description: "A normalized notice, project, report, budget, tender, or decision record.",
    },
    {
        icon: "download",
        title: "Document",
        description: "A source file linked to a policy record, with download and OCR status.",
    },
    {
        icon: "activity",
        title: "Scraper run",
        description: "An execution record with status, timing, item counts, and lineage.",
    },
];

export default function MethodologyPage() {
    return (
        <div className="page-stack">
            <PageHeader
                description="A short reference for the records, fields, and collection activity shown throughout this portal."
                eyebrow="Reference"
                title="Data guide"
            />

            <div className="guide-layout">
                <section className="panel guide-intro">
                    <div className="guide-intro-mark">
                        <Icon name="book" size={23} />
                    </div>
                    <div>
                        <p className="eyebrow">About this portal</p>
                        <h2>Public records, with their context intact.</h2>
                        <p>
                            Samaniti collects public information from local government portals and
                            normalizes it into a common policy record model. This portal is
                            intentionally read-only: every item points back to its source page, and
                            every collection execution remains visible in the activity log.
                        </p>
                    </div>
                </section>

                <section className="panel guide-scope">
                    <SectionHeading
                        description="The portal is designed around the collection scope below."
                        eyebrow="Scope"
                        title="Two provinces"
                    />
                    <div className="scope-list">
                        <div className="scope-row">
                            <span className="scope-row-mark scope-row-madhesh" />
                            <div>
                                <strong>Madhesh Province</strong>
                                <span>Local government records and source documents</span>
                            </div>
                            <Icon name="check" size={16} />
                        </div>
                        <div className="scope-row">
                            <span className="scope-row-mark scope-row-lumbini" />
                            <div>
                                <strong>Lumbini Province</strong>
                                <span>Local government records and source documents</span>
                            </div>
                            <Icon name="check" size={16} />
                        </div>
                    </div>
                    <Link className="text-link" to="/municipalities">
                        Open the directory <Icon name="arrow-right" size={15} />
                    </Link>
                </section>
            </div>

            <section className="panel guide-model-panel">
                <SectionHeading
                    description="The portal keeps the core collection entities visible without requiring a technical background."
                    eyebrow="Data model"
                    title="What each record represents"
                />
                <div className="model-grid">
                    {dataModel.map((item) => (
                        <article className="model-card" key={item.title}>
                            <span className="model-card-icon">
                                <Icon name={item.icon} size={19} />
                            </span>
                            <h3>{item.title}</h3>
                            <p>{item.description}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className="guide-callout">
                <div>
                    <p className="eyebrow">Need the audit trail?</p>
                    <h2>Collection activity is available as a first-class view.</h2>
                    <p>
                        Review run status, items added, items updated, and execution time without
                        leaving the portal.
                    </p>
                </div>
                <Link className="button button-light" to="/activity">
                    View collection activity <Icon name="arrow-right" size={16} />
                </Link>
            </section>
        </div>
    );
}
