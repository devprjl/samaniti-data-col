-- CreateTable
CREATE TABLE "municipalities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_ne" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipalities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipality_profiles" (
    "id" TEXT NOT NULL,
    "established_bs" TEXT,
    "total_wards" INTEGER,
    "population" INTEGER,
    "area_sq_km" DOUBLE PRECISION,
    "included_vdcs_ne" TEXT,
    "email" TEXT,
    "website" TEXT,
    "facebook_page" TEXT,
    "mobile_no" TEXT,
    "twitter_handle" TEXT,
    "total_schools" INTEGER,
    "municipality_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipality_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_entities" (
    "id" TEXT NOT NULL,
    "municipality_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title_ne" TEXT NOT NULL,
    "title_en" TEXT,
    "content_ne" TEXT,
    "content_en" TEXT,
    "type" TEXT,
    "fiscal_year" TEXT,
    "budget_amount" DECIMAL(65,30),
    "status" TEXT,
    "ward_no" INTEGER,
    "published_date" TEXT,
    "source_url" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraper_runs" (
    "id" TEXT NOT NULL,
    "municipality_id" TEXT,
    "scraper_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "items_added" INTEGER NOT NULL DEFAULT 0,
    "items_updated" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "scraper_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT,
    "original_url" TEXT NOT NULL,
    "storage_path" TEXT,
    "policy_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "download_error" TEXT,
    "download_status" TEXT NOT NULL DEFAULT 'pending',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "municipalities_code_key" ON "municipalities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "municipality_profiles_municipality_id_key" ON "municipality_profiles"("municipality_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_entities_source_url_key" ON "policy_entities"("source_url");

-- CreateIndex
CREATE UNIQUE INDEX "documents_original_url_key" ON "documents"("original_url");

-- AddForeignKey
ALTER TABLE "municipality_profiles" ADD CONSTRAINT "municipality_profiles_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_entities" ADD CONSTRAINT "policy_entities_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_runs" ADD CONSTRAINT "scraper_runs_municipality_id_fkey" FOREIGN KEY ("municipality_id") REFERENCES "municipalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_policy_entity_id_fkey" FOREIGN KEY ("policy_entity_id") REFERENCES "policy_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
