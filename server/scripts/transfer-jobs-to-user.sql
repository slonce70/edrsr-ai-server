-- Script to transfer all existing jobs to a specific user
-- Usage: Replace 'USER_ID_HERE' with the actual user UUID

-- IMPORTANT: Run this in a transaction to be safe
BEGIN;

-- Step 1: Show current jobs without user_id
SELECT 
    'Jobs without user_id:' as info,
    COUNT(*) as count
FROM jobs 
WHERE user_id IS NULL;

-- Step 2: Show current job_links without user_id  
SELECT 
    'Job links without user_id:' as info,
    COUNT(*) as count
FROM job_links 
WHERE user_id IS NULL;

-- Step 3: Show current job_results without user_id
SELECT 
    'Job results without user_id:' as info,
    COUNT(*) as count
FROM job_results 
WHERE user_id IS NULL;

-- Step 4: Show current chat_messages without user_id
SELECT 
    'Chat messages without user_id:' as info,
    COUNT(*) as count
FROM chat_messages 
WHERE user_id IS NULL;

-- ================================
-- ACTUAL TRANSFER (UNCOMMENT TO RUN)
-- ================================

-- Replace 'USER_ID_HERE' with the actual UUID of the target user
-- Example: '33cd7892-809b-42e5-aa64-105852cc087f'

/*
-- Update jobs table
UPDATE jobs 
SET user_id = 'USER_ID_HERE' 
WHERE user_id IS NULL;

-- Update job_links table  
UPDATE job_links 
SET user_id = 'USER_ID_HERE' 
WHERE user_id IS NULL;

-- Update job_results table
UPDATE job_results 
SET user_id = 'USER_ID_HERE' 
WHERE user_id IS NULL;

-- Update chat_messages table
UPDATE chat_messages 
SET user_id = 'USER_ID_HERE' 
WHERE user_id IS NULL;

-- Update parsed_cases table (if exists)
UPDATE parsed_cases 
SET user_id = 'USER_ID_HERE' 
WHERE user_id IS NULL;

-- Show results after update
SELECT 
    'Jobs transferred:' as info,
    COUNT(*) as count
FROM jobs 
WHERE user_id = 'USER_ID_HERE';

SELECT 
    'Job links transferred:' as info,
    COUNT(*) as count
FROM job_links 
WHERE user_id = 'USER_ID_HERE';

SELECT 
    'Job results transferred:' as info,
    COUNT(*) as count
FROM job_results 
WHERE user_id = 'USER_ID_HERE';

SELECT 
    'Chat messages transferred:' as info,
    COUNT(*) as count
FROM chat_messages 
WHERE user_id = 'USER_ID_HERE';
*/

-- Rollback for safety (comment out COMMIT and uncomment ROLLBACK to test first)
-- ROLLBACK;
COMMIT;
