DROP DATABASE IF EXISTS `simbiosis_lite`;
CREATE DATABASE `simbiosis_lite` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `simbiosis_lite`;

CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `device_id` VARCHAR(80) NOT NULL,
  `producer_code` VARCHAR(16) NULL,
  `first_name` VARCHAR(60) NOT NULL,
  `community` VARCHAR(120) NOT NULL,
  `crops` JSON NULL,
  `region_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_device` (`device_id`),
  UNIQUE KEY `uniq_producer_code` (`producer_code`),
  KEY `idx_region` (`region_hash`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `local_uuid` VARCHAR(80) NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `payload` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_local` (`user_id`, `local_uuid`),
  KEY `idx_user_type_created` (`user_id`, `type`, `created_at`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_records_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `alerts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `region_hash` CHAR(64) NOT NULL,
  `local_uuid` CHAR(36) NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `severity` TINYINT UNSIGNED NOT NULL,
  `message` VARCHAR(255) NOT NULL,
  `payload` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_region_local` (`region_hash`, `local_uuid`),
  KEY `idx_region_created` (`region_hash`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `plant_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `region_hash` CHAR(64) NOT NULL,
  `crop` VARCHAR(20) NOT NULL,
  `features` JSON NOT NULL,
  `prediction` JSON NULL,
  `label` VARCHAR(60) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_crop_created` (`crop`, `created_at`),
  KEY `idx_region_crop_created` (`region_hash`, `crop`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
